import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { ClipboardEntry } from './clipboard.js';

const HISTORY_FILENAME = 'history.json';

//keeps the entries in memory and mirrors them to ~/.cache/gnome-recall/history.json on every change
export class HistoryManager {
    constructor(opts = {}) {
        this._settings = opts.settings || null;
        this._entries = [];
        this._onUpdateCallbacks = [];

        this._cacheDir = GLib.build_filenamev([
            GLib.get_user_cache_dir(), 'gnome-recall'
        ]);
        this._historyPath = GLib.build_filenamev([
            this._cacheDir, HISTORY_FILENAME
        ]);
        this._imagesDir = GLib.build_filenamev([
            this._cacheDir, 'images'
        ]);

        GLib.mkdir_with_parents(this._cacheDir, 0o755);
        GLib.mkdir_with_parents(this._imagesDir, 0o755);

        this._loadFromDisk();

        //"clear on restart" setting, pinned stuff survives this
        if (this._settings && this._settings.get_boolean('clear-on-boot')) {
            this.clearUnpinned();
        }
    }

    get maxSize() {
        if (this._settings) {
            return this._settings.get_int('max-history-size');
        }
        return 50;
    }

    //newest first, pinned ones bubble to the top unless the setting says otherwise
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

    getPinnedEntries() {
        return this._entries.filter(e => e.pinned);
    }

    getUnpinnedEntries() {
        return this._entries.filter(e => !e.pinned);
    }

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

    addEntry(entry) {
        //copying the same thing twice in a row just bumps the timestamp
        const recent = this._entries.find(e => !e.pinned);
        if (recent && entry.type === 'text' && recent.type === 'text' &&
            recent.content === entry.content) {
            recent.timestamp = entry.timestamp;
            this._saveToDisk();
            return;
        }

        //if it exists further down the list, move it to the top instead of duplicating
        const existingIdx = this._entries.findIndex(e =>
            !e.pinned && e.type === entry.type && e.type === 'text' && e.content === entry.content
        );
        if (existingIdx >= 0) {
            this._entries.splice(existingIdx, 1);
        }

        this._entries.unshift(entry);

        this._enforceLimit();

        this._saveToDisk();
        this._emitUpdate();
    }

    togglePin(id) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry) return false;

        entry.pinned = !entry.pinned;
        this._saveToDisk();
        this._emitUpdate();
        return entry.pinned;
    }

    deleteEntry(id) {
        const idx = this._entries.findIndex(e => e.id === id);
        if (idx < 0) return;

        const entry = this._entries[idx];

        if (entry.imagePath) {
            this._deleteFile(entry.imagePath);
        }

        this._entries.splice(idx, 1);
        this._saveToDisk();
        this._emitUpdate();
    }

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

    get length() {
        return this._entries.length;
    }

    onUpdate(callback) {
        this._onUpdateCallbacks.push(callback);
    }

    getEntry(id) {
        return this._entries.find(e => e.id === id) || null;
    }

    //drop the oldest unpinned entries until we fit in max-history-size
    _enforceLimit() {
        const max = this.maxSize;
        while (this._entries.length > max) {
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
            //everything left is pinned, nothing more to drop
            } else {
                break;
            }
        }
    }

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

    _emitUpdate() {
        for (const cb of this._onUpdateCallbacks) {
            try {
                cb();
            } catch (e) {
                console.error(`[Recall] Update callback error: ${e.message}`);
            }
        }
    }

    destroy() {
        this._onUpdateCallbacks = [];
        this._settings = null;
    }
}
