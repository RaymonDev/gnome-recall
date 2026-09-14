import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';

const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

//used to auto tag entries as link/color so the ui can show a badge
const URL_REGEX = /^https?:\/\/[^\s]+$/i;
const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const RGB_COLOR_REGEX = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*[\d.]+)?\s*\)$/i;

const IMAGE_MIMETYPES = ['image/png', 'image/jpeg', 'image/bmp', 'image/gif', 'image/webp'];

//one clipboard item, gets serialized to history.json as is
export class ClipboardEntry {
    constructor(opts) {
        this.id = opts.id || GLib.uuid_string_random();
        this.type = opts.type || 'text';
        this.content = opts.content || '';
        this.preview = opts.preview || '';
        this.timestamp = opts.timestamp || Date.now();
        this.pinned = opts.pinned || false;
        this.imagePath = opts.imagePath || null;
    }

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

    static fromJSON(obj) {
        return new ClipboardEntry(obj);
    }
}

//listens to the system clipboard and hands new entries to whoever registered with onChange
export class ClipboardMonitor {
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
        //lets us abort a pending image transfer if the extension gets disabled mid way
        this._cancellable = new Gio.Cancellable();

        GLib.mkdir_with_parents(this._cacheDir, 0o755);
    }

    start() {
        if (this._ownerChangedId) return;

        //owner-changed fires on every copy, way cheaper than polling
        this._ownerChangedId = this._selection.connect(
            'owner-changed',
            this._onOwnerChanged.bind(this)
        );
    }

    stop() {
        if (this._ownerChangedId) {
            this._selection.disconnect(this._ownerChangedId);
            this._ownerChangedId = null;
        }
    }

    onChange(callback) {
        this._onChangeCallbacks.push(callback);
    }

    setPrivateMode(enabled) {
        this._privateMode = enabled;
    }

    setEnableImages(enabled) {
        this._enableImages = enabled;
    }

    setClipboardText(text) {
        //remember it so our own write doesnt get picked up as a new entry
        this._lastText = text;
        this._clipboard.set_text(CLIPBOARD_TYPE, text);
    }

    //st.clipboard cant do images, so we go through meta.selection directly
    setClipboardImage(imagePath) {
        try {
            const file = Gio.File.new_for_path(imagePath);
            const [, contents] = file.load_contents(null);
            const bytes = GLib.Bytes.new(contents);

            const source = Meta.SelectionSourceMemory.new('image/png', bytes);
            this._selection.set_owner(Meta.SelectionType.SELECTION_CLIPBOARD, source);
        } catch (e) {
            console.error(`[Recall] Failed to set clipboard image: ${e.message}`);
        }
    }

    _onOwnerChanged(_selection, selectionType, _selectionSource) {
        if (selectionType !== Meta.SelectionType.SELECTION_CLIPBOARD) return;
        if (this._privateMode) return;

        this._readTextClipboard();
    }

    _readTextClipboard() {
        this._clipboard.get_text(CLIPBOARD_TYPE, (_clipboard, text) => {
            //async, so bail if we got destroyed while waiting
            if (!this._clipboard) return;
            if (text && text.length > 0 && text !== this._lastText) {
                this._lastText = text;
                const entry = this._createTextEntry(text);
                this._emitChange(entry);
            //no text usually means an image (screenshots etc)
            } else if (!text || text.length === 0) {
                if (this._enableImages) {
                    this._readImageClipboard();
                }
            }
        });
    }

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

        try {
            const outputStream = Gio.MemoryOutputStream.new_resizable();
            this._selection.transfer_async(
                Meta.SelectionType.SELECTION_CLIPBOARD,
                imageMime,
                -1,
                outputStream,
                this._cancellable,
                (selection, result) => {
                    try {
                        selection.transfer_finish(result);
                        //same deal, destroyed mid transfer
                        if (!this._clipboard) return;
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

    //images live in ~/.cache/gnome-recall/images, history only stores the path
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

    _emitChange(entry) {
        for (const cb of this._onChangeCallbacks) {
            try {
                cb(entry);
            } catch (e) {
                console.error(`[Recall] Callback error: ${e.message}`);
            }
        }
    }

    destroy() {
        this.stop();
        this._cancellable.cancel();
        this._onChangeCallbacks = [];
        this._clipboard = null;
        this._selection = null;
    }
}
