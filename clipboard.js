/* clipboard.js — Clipboard monitoring and I/O for GNOME Recall
 *
 * Monitors the system clipboard for changes using Meta.Selection's
 * owner-changed signal and reads/writes clipboard content via St.Clipboard.
 * Supports both text and image content types.
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';

const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

// Content type detection patterns
const URL_REGEX = /^https?:\/\/[^\s]+$/i;
const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const RGB_COLOR_REGEX = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*[\d.]+)?\s*\)$/i;

// Image MIME types we look for
const IMAGE_MIMETYPES = ['image/png', 'image/jpeg', 'image/bmp', 'image/gif', 'image/webp'];

/**
 * Represents a single clipboard entry with metadata.
 */
export class ClipboardEntry {
    /**
     * @param {object} opts
     * @param {string} opts.type — 'text' | 'image' | 'link' | 'color'
     * @param {string} opts.content — Text content or image file path
     * @param {string} [opts.preview] — Truncated preview text
     * @param {number} [opts.timestamp] — Unix timestamp in ms
     * @param {boolean} [opts.pinned] — Whether this entry is pinned
     * @param {string} [opts.id] — Unique identifier
     * @param {string} [opts.imagePath] — Path to cached image file (for image type)
     */
    constructor(opts) {
        this.id = opts.id || GLib.uuid_string_random();
        this.type = opts.type || 'text';
        this.content = opts.content || '';
        this.preview = opts.preview || '';
        this.timestamp = opts.timestamp || Date.now();
        this.pinned = opts.pinned || false;
        this.imagePath = opts.imagePath || null;
    }

    /**
     * Serialize to a plain object for JSON storage.
     */
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            content: this.content,
            preview: this.preview,
            timestamp: this.timestamp,
            pinned: this.pinned,
            imagePath: this.imagePath,
        };
    }

    /**
     * Create a ClipboardEntry from a plain JSON object.
     */
    static fromJSON(obj) {
        return new ClipboardEntry(obj);
    }
}

/**
 * ClipboardMonitor — Watches the clipboard and emits events when content changes.
 */
export class ClipboardMonitor {
    /**
     * @param {object} opts
     * @param {string} opts.cacheDir — Directory for caching image data
     */
    constructor(opts = {}) {
        this._clipboard = St.Clipboard.get_default();
        this._selection = global.get_display().get_selection();
        this._ownerChangedId = null;
        this._lastText = null;
        this._onChangeCallbacks = [];
        this._cacheDir = opts.cacheDir || GLib.build_filenamev([
            GLib.get_user_cache_dir(), 'gnome-recall', 'images'
        ]);
        this._privateMode = false;
        this._enableImages = true;

        // Ensure cache directory exists
        GLib.mkdir_with_parents(this._cacheDir, 0o755);
    }

    /**
     * Start monitoring the clipboard for changes.
     */
    start() {
        if (this._ownerChangedId) return;

        this._ownerChangedId = this._selection.connect(
            'owner-changed',
            this._onOwnerChanged.bind(this)
        );
    }

    /**
     * Stop monitoring.
     */
    stop() {
        if (this._ownerChangedId) {
            this._selection.disconnect(this._ownerChangedId);
            this._ownerChangedId = null;
        }
    }

    /**
     * Register a callback for clipboard changes.
     * @param {function(ClipboardEntry)} callback
     */
    onChange(callback) {
        this._onChangeCallbacks.push(callback);
    }

    /**
     * Set private mode (when true, changes are ignored).
     */
    setPrivateMode(enabled) {
        this._privateMode = enabled;
    }

    /**
     * Set whether image tracking is enabled.
     */
    setEnableImages(enabled) {
        this._enableImages = enabled;
    }

    /**
     * Write text content to the system clipboard.
     * @param {string} text
     */
    setClipboardText(text) {
        this._lastText = text; // prevent re-trigger
        this._clipboard.set_text(CLIPBOARD_TYPE, text);
    }

    /**
     * Write an image file back to the clipboard.
     * Uses Meta.Selection to transfer the image content.
     * @param {string} imagePath — Absolute path to an image file
     */
    setClipboardImage(imagePath) {
        try {
            const file = Gio.File.new_for_path(imagePath);
            const [, contents] = file.load_contents(null);
            const bytes = GLib.Bytes.new(contents);

            // Use Meta.Selection to set image content
            const source = Meta.SelectionSourceMemory.new('image/png', bytes);
            this._selection.set_owner(Meta.SelectionType.SELECTION_CLIPBOARD, source);
        } catch (e) {
            console.error(`[Recall] Failed to set clipboard image: ${e.message}`);
        }
    }

    /**
     * Handle clipboard owner-changed signal.
     */
    _onOwnerChanged(_selection, selectionType, _selectionSource) {
        if (selectionType !== Meta.SelectionType.SELECTION_CLIPBOARD) return;
        if (this._privateMode) return;

        // Try to read text first
        this._readTextClipboard();
    }

    /**
     * Read text from the clipboard.
     */
    _readTextClipboard() {
        this._clipboard.get_text(CLIPBOARD_TYPE, (_clipboard, text) => {
            if (text && text.length > 0 && text !== this._lastText) {
                this._lastText = text;
                const entry = this._createTextEntry(text);
                this._emitChange(entry);
            } else if (!text || text.length === 0) {
                // No text — check for image if enabled
                if (this._enableImages) {
                    this._readImageClipboard();
                }
            }
        });
    }

    /**
     * Attempt to read image data from the clipboard using Meta.Selection.
     */
    _readImageClipboard() {
        const mimetypes = this._clipboard.get_mimetypes(CLIPBOARD_TYPE);
        if (!mimetypes) return;

        let imageMime = null;
        for (const mime of IMAGE_MIMETYPES) {
            if (mimetypes.includes(mime)) {
                imageMime = mime;
                break;
            }
        }

        if (!imageMime) return;

        // Transfer image data using Meta.Selection
        try {
            const outputStream = Gio.MemoryOutputStream.new_resizable();
            this._selection.transfer_async(
                Meta.SelectionType.SELECTION_CLIPBOARD,
                imageMime,
                -1, // max size
                outputStream,
                null, // cancellable
                (source, result) => {
                    try {
                        this._selection.transfer_finish(result);
                        outputStream.close(null);

                        const data = outputStream.steal_as_bytes();
                        if (data && data.get_size() > 0) {
                            this._saveImageAndEmit(data, imageMime);
                        }
                    } catch (e) {
                        console.error(`[Recall] Failed to read image clipboard: ${e.message}`);
                    }
                }
            );
        } catch (e) {
            console.error(`[Recall] Failed to initiate image transfer: ${e.message}`);
        }
    }

    /**
     * Save image bytes to the cache directory and emit a change event.
     */
    _saveImageAndEmit(bytes, mime) {
        const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'png';
        const filename = `clip_${Date.now()}.${ext}`;
        const filepath = GLib.build_filenamev([this._cacheDir, filename]);

        try {
            const file = Gio.File.new_for_path(filepath);
            const outputStream = file.replace(null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            outputStream.write_bytes(bytes, null);
            outputStream.close(null);

            const entry = new ClipboardEntry({
                type: 'image',
                content: filepath,
                preview: `Image (${Math.round(bytes.get_size() / 1024)} KB)`,
                imagePath: filepath,
            });

            this._emitChange(entry);
        } catch (e) {
            console.error(`[Recall] Failed to save image: ${e.message}`);
        }
    }

    /**
     * Create a text ClipboardEntry with auto-detected type.
     */
    _createTextEntry(text) {
        let type = 'text';
        const trimmed = text.trim();

        if (URL_REGEX.test(trimmed)) {
            type = 'link';
        } else if (HEX_COLOR_REGEX.test(trimmed) || RGB_COLOR_REGEX.test(trimmed)) {
            type = 'color';
        }

        return new ClipboardEntry({
            type,
            content: text,
            preview: text.substring(0, 200),
        });
    }

    /**
     * Emit a change event to all registered callbacks.
     */
    _emitChange(entry) {
        for (const cb of this._onChangeCallbacks) {
            try {
                cb(entry);
            } catch (e) {
                console.error(`[Recall] Callback error: ${e.message}`);
            }
        }
    }

    /**
     * Clean up resources.
     */
    destroy() {
        this.stop();
        this._onChangeCallbacks = [];
        this._clipboard = null;
        this._selection = null;
    }
}
