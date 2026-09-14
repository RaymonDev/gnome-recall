/* historyManager.js — Persistent clipboard history management for GNOME Recall
 *
 * Manages an in-memory array of ClipboardEntry objects with JSON persistence.
 * Handles pinning, deletion, search, and size limits.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { ClipboardEntry } from './clipboard.js';

const HISTORY_FILENAME = 'history.json';

/**
 * HistoryManager — Stores, persists, and queries clipboard history.
 */
export class HistoryManager {
    /**
     * @param {object} opts
     * @param {Gio.Settings} opts.settings — GSettings instance
     */
    constructor(opts = {}) {
        this._settings = opts.settings || null;
        this._entries = [];
        this._onUpdateCallbacks = [];

        // Paths
        this._cacheDir = GLib.build_filenamev([
            GLib.get_user_cache_dir(), 'gnome-recall'
        ]);
        this._historyPath = GLib.build_filenamev([
            this._cacheDir, HISTORY_FILENAME
        ]);
        this._imagesDir = GLib.build_filenamev([
            this._cacheDir, 'images'
        ]);

        // Ensure directories exist
        GLib.mkdir_with_parents(this._cacheDir, 0o755);
        GLib.mkdir_with_parents(this._imagesDir, 0o755);

        // Load persisted history
        this._loadFromDisk();

        // Apply clear-on-boot if needed
        if (this._settings && this._settings.get_boolean('clear-on-boot')) {
            this.clearUnpinned();
        }
    }

    /**
     * Get the current max history size from settings.
     */
    get maxSize() {
        if (this._settings) {
            return this._settings.get_int('max-history-size');
        }
        return 50;
    }

    /**
     * Get all entries, optionally with pinned on top.
     * @param {object} [opts]
     * @param {boolean} [opts.pinnedOnTop] — Whether to sort pinned items first
     * @returns {ClipboardEntry[]}
     */
    getEntries(opts = {}) {
        const pinnedOnTop = opts.pinnedOnTop !== undefined ? opts.pinnedOnTop :
            (this._settings ? this._settings.get_boolean('pinned-on-top') : true);

        if (pinnedOnTop) {
            const pinned = this._entries.filter(e => e.pinned);
            const unpinned = this._entries.filter(e => !e.pinned);
            return [...pinned, ...unpinned];
        }
        return [...this._entries];
    }

    /**
     * Get only pinned entries.
     */
    getPinnedEntries() {
        return this._entries.filter(e => e.pinned);
    }

    /**
     * Get only unpinned entries.
     */
    getUnpinnedEntries() {
        return this._entries.filter(e => !e.pinned);
    }

    /**
     * Search entries by query text.
     * @param {string} query
     * @returns {ClipboardEntry[]}
     */
    search(query) {
        if (!query || query.length === 0) return this.getEntries();

        const lowerQuery = query.toLowerCase();
        const all = this.getEntries();
        return all.filter(entry => {
            if (entry.type === 'image') {
                return entry.preview.toLowerCase().includes(lowerQuery);
            }
            return entry.content.toLowerCase().includes(lowerQuery);
        });
    }

    /**
     * Add a new entry to history.
     * Deduplicates against the most recent entry.
     * @param {ClipboardEntry} entry
     */
    addEntry(entry) {
        // Deduplicate: skip if identical to the most recent non-pinned entry
        const recent = this._entries.find(e => !e.pinned);
        if (recent && entry.type === 'text' && recent.type === 'text' &&
            recent.content === entry.content) {
            // Update timestamp of existing entry instead
            recent.timestamp = entry.timestamp;
            this._saveToDisk();
            return;
        }

        // Also check if the same text already exists deeper in history — move it to top
        const existingIdx = this._entries.findIndex(e =>
            !e.pinned && e.type === entry.type && e.type === 'text' && e.content === entry.content
        );
        if (existingIdx >= 0) {
            this._entries.splice(existingIdx, 1);
        }

        // Add to front
        this._entries.unshift(entry);

        // Enforce size limit (only remove unpinned entries)
        this._enforceLimit();

        this._saveToDisk();
        this._emitUpdate();
    }

    /**
     * Toggle the pinned state of an entry.
     * @param {string} id — Entry ID
     * @returns {boolean} New pinned state
     */
    togglePin(id) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry) return false;

        entry.pinned = !entry.pinned;
        this._saveToDisk();
        this._emitUpdate();
        return entry.pinned;
    }

    /**
     * Delete a single entry by ID.
     * @param {string} id
     */
    deleteEntry(id) {
        const idx = this._entries.findIndex(e => e.id === id);
        if (idx < 0) return;

        const entry = this._entries[idx];

        // If it's an image, clean up the cached file
        if (entry.imagePath) {
            this._deleteFile(entry.imagePath);
        }

        this._entries.splice(idx, 1);
        this._saveToDisk();
        this._emitUpdate();
    }

    /**
     * Clear all unpinned entries.
     */
    clearUnpinned() {
        const unpinned = this._entries.filter(e => !e.pinned);
        for (const entry of unpinned) {
            if (entry.imagePath) {
                this._deleteFile(entry.imagePath);
            }
        }
        this._entries = this._entries.filter(e => e.pinned);
        this._saveToDisk();
        this._emitUpdate();
    }

    /**
     * Clear absolutely everything including pinned items.
     */
    clearAll() {
        for (const entry of this._entries) {
            if (entry.imagePath) {
                this._deleteFile(entry.imagePath);
            }
        }
        this._entries = [];
        this._saveToDisk();
        this._emitUpdate();
    }

    /**
     * Get the total count of entries.
     */
    get length() {
        return this._entries.length;
    }

    /**
     * Register a callback for history updates.
     * @param {function} callback
     */
    onUpdate(callback) {
        this._onUpdateCallbacks.push(callback);
    }

    /**
     * Get an entry by ID.
     * @param {string} id
     * @returns {ClipboardEntry|null}
     */
    getEntry(id) {
        return this._entries.find(e => e.id === id) || null;
    }

    // ---- Private methods ----

    /**
     * Enforce the max history size by removing oldest unpinned entries.
     */
    _enforceLimit() {
        const max = this.maxSize;
        while (this._entries.length > max) {
            // Find the last unpinned entry and remove it
            let lastUnpinnedIdx = -1;
            for (let i = this._entries.length - 1; i >= 0; i--) {
                if (!this._entries[i].pinned) {
                    lastUnpinnedIdx = i;
                    break;
                }
            }
            if (lastUnpinnedIdx >= 0) {
                const removed = this._entries[lastUnpinnedIdx];
                if (removed.imagePath) {
                    this._deleteFile(removed.imagePath);
                }
                this._entries.splice(lastUnpinnedIdx, 1);
            } else {
                // All entries are pinned — nothing to remove
                break;
            }
        }
    }

    /**
     * Load history from the JSON file on disk.
     */
    _loadFromDisk() {
        try {
            if (!GLib.file_test(this._historyPath, GLib.FileTest.EXISTS)) {
                this._entries = [];
                return;
            }

            const [ok, contents] = GLib.file_get_contents(this._historyPath);
            if (!ok) {
                this._entries = [];
                return;
            }

            const decoder = new TextDecoder('utf-8');
            const json = decoder.decode(contents);
            const data = JSON.parse(json);

            if (Array.isArray(data)) {
                this._entries = data.map(obj => ClipboardEntry.fromJSON(obj));
            } else {
                this._entries = [];
            }
        } catch (e) {
            console.error(`[Recall] Failed to load history: ${e.message}`);
            this._entries = [];
        }
    }

    /**
     * Persist the current history to disk as JSON.
     */
    _saveToDisk() {
        try {
            const json = JSON.stringify(
                this._entries.map(e => e.toJSON()),
                null,
                2
            );

            const file = Gio.File.new_for_path(this._historyPath);
            file.replace_contents(
                new TextEncoder().encode(json),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (e) {
            console.error(`[Recall] Failed to save history: ${e.message}`);
        }
    }

    /**
     * Delete a file from disk (used for image cleanup).
     */
    _deleteFile(path) {
        try {
            const file = Gio.File.new_for_path(path);
            if (file.query_exists(null)) {
                file.delete(null);
            }
        } catch (e) {
            console.error(`[Recall] Failed to delete file ${path}: ${e.message}`);
        }
    }

    /**
     * Emit update event to all registered callbacks.
     */
    _emitUpdate() {
        for (const cb of this._onUpdateCallbacks) {
            try {
                cb();
            } catch (e) {
                console.error(`[Recall] Update callback error: ${e.message}`);
            }
        }
    }

    /**
     * Clean up resources.
     */
    destroy() {
        this._onUpdateCallbacks = [];
        this._settings = null;
    }
}
