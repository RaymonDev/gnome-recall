/* ui/recallDialog.js — Main popup dialog for GNOME Recall
 *
 * A centered, modal popup that shows clipboard history with search,
 * pin, delete, and clear-all functionality. Styled to feel native
 * to GNOME while matching the Windows 11 Win+V experience.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SearchBar } from './searchBar.js';
import { ClipboardItemWidget } from './clipboardItem.js';

/**
 * RecallDialog — The main clipboard history popup.
 */
export class RecallDialog {
    /**
     * @param {object} opts
     * @param {import('../historyManager.js').HistoryManager} opts.historyManager
     * @param {import('../clipboard.js').ClipboardMonitor} opts.clipboardMonitor
     * @param {Gio.Settings} opts.settings
     */
    constructor(opts) {
        this._historyManager = opts.historyManager;
        this._clipboardMonitor = opts.clipboardMonitor;
        this._settings = opts.settings;
        this._openPreferences = opts.openPreferences || (() => {});
        this._isOpen = false;
        this._itemWidgets = [];
        this._confirmOverlay = null;

        this._build();
    }

    /**
     * Build the full dialog UI structure.
     */
    _build() {
        // Single full-screen container that owns the modal grab. Both the
        // backdrop and the dialog live inside it so input to either is
        // delivered normally (like the shell's own ModalDialog).
        this._container = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            visible: false,
        });

        // --- Backdrop (semi-transparent overlay) ---
        this._backdrop = new St.Widget({
            style_class: 'recall-backdrop',
            reactive: true,
            x_expand: true,
            y_expand: true,
        });
        this._backdrop.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this._container.add_child(this._backdrop);

        // --- Main dialog container ---
        const width = this._settings.get_int('window-width');
        const height = this._settings.get_int('window-height');

        this._dialog = new St.BoxLayout({
            style_class: 'recall-dialog popup-menu-content',
            vertical: true,
            width: width,
            height: height,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._container.add_child(this._dialog);

        // NOTE: never connect a button-press-event handler returning
        // EVENT_STOP on an ancestor of St.Buttons — on GNOME 47+ that
        // cancels the ClutterClickGesture and the buttons stop working.

        // --- Header ---
        const header = new St.BoxLayout({
            style_class: 'recall-header',
            vertical: false,
            x_expand: true,
        });

        const titleLabel = new St.Label({
            style_class: 'recall-title',
            text: 'Clipboard History',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        header.add_child(titleLabel);

        // Private mode indicator
        this._privateIndicator = new St.BoxLayout({
            style_class: 'recall-private-indicator',
            visible: this._settings.get_boolean('private-mode'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._privateIndicator.add_child(new St.Icon({
            icon_name: 'security-medium-symbolic',
            icon_size: 12,
        }));
        this._privateIndicator.add_child(new St.Label({
            style_class: 'recall-private-label',
            text: ' Private',
        }));
        header.add_child(this._privateIndicator);

        // Header buttons
        const headerBtns = new St.BoxLayout({
            style_class: 'recall-header-buttons',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Clear All button
        const clearBtn = new St.Button({
            style_class: 'recall-header-btn recall-header-btn-destructive button',
            label: 'Clear All',
            can_focus: true,
        });
        clearBtn.connect('clicked', () => {
            if (this._settings.get_boolean('confirm-clear')) {
                this._showClearConfirmation();
            } else {
                this._historyManager.clearUnpinned();
            }
        });
        headerBtns.add_child(clearBtn);

        // Settings button
        const settingsBtn = new St.Button({
            style_class: 'recall-action-btn recall-header-icon-btn',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'emblem-system-symbolic',
                style_class: 'recall-action-btn-icon',
            }),
        });
        settingsBtn.connect('clicked', () => {
            this.close();
            this._openPreferences();
        });
        headerBtns.add_child(settingsBtn);

        header.add_child(headerBtns);
        this._dialog.add_child(header);

        // --- Search bar ---
        this._searchBar = new SearchBar({
            onSearch: (query) => this._onSearch(query),
        });
        this._dialog.add_child(this._searchBar.actor);

        // --- Separator ---
        const separator = new St.Widget({
            style_class: 'recall-separator',
            x_expand: true,
        });
        this._dialog.add_child(separator);

        // --- Scrollable list ---
        this._scrollView = new St.ScrollView({
            style_class: 'recall-scroll-view',
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
        });

        this._listBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        this._scrollView.set_child(this._listBox);
        this._dialog.add_child(this._scrollView);

        // --- Empty state (shown when no entries) ---
        this._emptyState = new St.BoxLayout({
            style_class: 'recall-empty-state',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            visible: false,
        });

        this._emptyState.add_child(new St.Icon({
            style_class: 'recall-empty-icon',
            icon_name: 'edit-paste-symbolic',
        }));
        this._emptyState.add_child(new St.Label({
            style_class: 'recall-empty-title',
            text: 'No clipboard history',
        }));
        this._emptyState.add_child(new St.Label({
            style_class: 'recall-empty-subtitle',
            text: 'Copy something to see it here.\nPinned items survive reboots.',
        }));
        this._dialog.add_child(this._emptyState);

        // --- Footer ---
        this._footer = new St.BoxLayout({
            style_class: 'recall-footer',
            x_expand: true,
        });
        this._footerLabel = new St.Label({
            style_class: 'recall-footer-label',
            text: '',
            x_expand: true,
        });
        this._footer.add_child(this._footerLabel);

        const shortcutHint = new St.Label({
            style_class: 'recall-footer-label',
            text: 'Esc to close',
        });
        this._footer.add_child(shortcutHint);
        this._dialog.add_child(this._footer);

        // Add to the UI group
        Main.layoutManager.addTopChrome(this._container);

        // Register for history updates
        this._historyManager.onUpdate(() => {
            if (this._isOpen) {
                this._refreshList();
            }
        });
    }

    /**
     * Toggle the dialog open/closed.
     */
    toggle() {
        if (this._isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Open the dialog.
     */
    open() {
        if (this._isOpen) return;
        this._isOpen = true;

        // Cover the primary monitor; BinLayout centers the dialog inside
        const monitor = Main.layoutManager.primaryMonitor;
        this._container.set_position(monitor.x, monitor.y);
        this._container.set_size(monitor.width, monitor.height);
        this._dialog.set_size(
            this._settings.get_int('window-width'),
            this._settings.get_int('window-height')
        );

        // Update private mode indicator
        this._privateIndicator.visible = this._settings.get_boolean('private-mode');

        // Populate the list
        this._searchBar.clear();
        this._refreshList();

        // Show with animation
        this._container.visible = true;
        this._backdrop.opacity = 0;
        this._backdrop.ease({
            opacity: 255,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._dialog.opacity = 0;
        this._dialog.scale_x = 0.95;
        this._dialog.scale_y = 0.95;
        this._dialog.pivot_point = new Graphene.Point({ x: 0.5, y: 0.5 });
        this._dialog.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Grab keyboard focus
        this._grabModal();

        // Focus search bar after a small delay
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (this._isOpen) {
                this._searchBar.focus();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Close the dialog.
     */
    close() {
        if (!this._isOpen) return;
        this._isOpen = false;

        this._ungrabModal();
        this._hideClearConfirmation();

        // Animate out
        this._backdrop.ease({
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });

        this._dialog.ease({
            opacity: 0,
            scale_x: 0.95,
            scale_y: 0.95,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (!this._isOpen) {
                    this._container.visible = false;
                    this._clearList();
                }
            },
        });
    }

    /**
     * Grab modal input.
     */
    _grabModal() {
        this._modal = Main.pushModal(this._container, {
            actionMode: Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        });

        // Handle key events for the dialog
        this._keyPressId = this._container.connect('key-press-event', (_actor, event) => {
            return this._onKeyPress(event);
        });
    }

    /**
     * Release modal input.
     */
    _ungrabModal() {
        if (this._keyPressId) {
            this._container.disconnect(this._keyPressId);
            this._keyPressId = null;
        }

        if (this._modal) {
            const grab = this._modal;
            this._modal = null;
            try {
                Main.popModal(grab);
            } catch (e) {
                // Never leave the compositor grab stuck: dismiss it directly.
                console.error(`[Recall] popModal failed: ${e.message}`);
                grab.dismiss();
            }
        }
    }

    /**
     * Handle key press events in the dialog.
     */
    _onKeyPress(event) {
        const symbol = event.get_key_symbol();

        switch (symbol) {
            case Clutter.KEY_Escape:
                // Dismiss confirmation first, then clear search, then close
                if (this._confirmOverlay) {
                    this._hideClearConfirmation();
                } else if (this._searchBar.getText().length > 0) {
                    this._searchBar.clear();
                } else {
                    this.close();
                }
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Down:
                this._navigateList(1);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Up:
                this._navigateList(-1);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Tab:
                this._navigateList(1);
                return Clutter.EVENT_STOP;

            default:
                // If user starts typing, redirect to search bar
                if (symbol >= 32 && symbol <= 126 && !this._searchBar.entry.has_key_focus()) {
                    this._searchBar.focus();
                }
                return Clutter.EVENT_PROPAGATE;
        }
    }

    /**
     * Navigate the list by delta (1 = down, -1 = up).
     */
    _navigateList(delta) {
        if (this._itemWidgets.length === 0) return;

        // Find currently focused item
        let currentIdx = -1;
        for (let i = 0; i < this._itemWidgets.length; i++) {
            if (this._itemWidgets[i].actor.has_key_focus()) {
                currentIdx = i;
                break;
            }
        }

        let nextIdx;
        if (currentIdx < 0) {
            // No item focused — go to first
            nextIdx = delta > 0 ? 0 : this._itemWidgets.length - 1;
        } else {
            nextIdx = currentIdx + delta;
            if (nextIdx < 0) nextIdx = this._itemWidgets.length - 1;
            if (nextIdx >= this._itemWidgets.length) nextIdx = 0;
        }

        global.stage.set_key_focus(this._itemWidgets[nextIdx].actor);

        // Ensure the focused item is visible in the scroll view
        const item = this._itemWidgets[nextIdx].actor;
        this._ensureVisible(item);
    }

    /**
     * Scroll so that the given actor is visible within the scroll view.
     */
    _ensureVisible(actor) {
        const adj = this._scrollView.vadjustment ?? this._scrollView.vscroll?.adjustment;
        if (!adj) return;

        const [, itemY] = actor.get_transformed_position();
        const [, scrollY] = this._scrollView.get_transformed_position();
        const scrollHeight = this._scrollView.get_height();
        const itemHeight = actor.get_height();

        const relativeY = itemY - scrollY;

        if (relativeY < 0) {
            adj.value = adj.value + relativeY;
        } else if (relativeY + itemHeight > scrollHeight) {
            adj.value = adj.value + (relativeY + itemHeight - scrollHeight);
        }
    }

    /**
     * Handle search text changes.
     */
    _onSearch(query) {
        this._refreshList(query);
    }

    /**
     * Refresh the list of items.
     * @param {string} [query] — Optional search query
     */
    _refreshList(query) {
        this._clearList();

        query = query || this._searchBar.getText();
        const entries = query
            ? this._historyManager.search(query)
            : this._historyManager.getEntries();
        const totalCount = this._historyManager.length;

        // Update footer
        const pinnedCount = this._historyManager.getPinnedEntries().length;
        if (pinnedCount > 0) {
            this._footerLabel.set_text(`${totalCount} items · ${pinnedCount} pinned`);
        } else {
            this._footerLabel.set_text(`${totalCount} items`);
        }

        if (entries.length === 0) {
            // Show empty state
            this._scrollView.visible = false;
            this._emptyState.visible = true;
            return;
        }

        this._scrollView.visible = true;
        this._emptyState.visible = false;

        // Add section headers if we have both pinned and unpinned
        const hasPinned = entries.some(e => e.pinned);
        const hasUnpinned = entries.some(e => !e.pinned);
        const pinnedOnTop = this._settings.get_boolean('pinned-on-top');

        let addedPinnedHeader = false;
        let addedHistoryHeader = false;

        const maxPreviewLength = this._settings.get_int('max-preview-length');
        const showTimestamps = this._settings.get_boolean('show-timestamps');

        for (const entry of entries) {
            // Section headers
            if (pinnedOnTop && hasPinned && hasUnpinned) {
                if (entry.pinned && !addedPinnedHeader) {
                    addedPinnedHeader = true;
                    this._addSectionHeader('Pinned', 'starred-symbolic');
                } else if (!entry.pinned && !addedHistoryHeader) {
                    addedHistoryHeader = true;
                    this._addSectionHeader('Recent', 'document-open-recent-symbolic');
                }
            }

            const widget = new ClipboardItemWidget({
                entry: entry,
                maxPreviewLength: maxPreviewLength,
                showTimestamps: showTimestamps,
                isActive: false,
                onSelect: (id) => this._onSelectEntry(id),
                onPin: (id) => this._onTogglePin(id),
                onDelete: (id) => this._onDeleteEntry(id),
            });

            this._listBox.add_child(widget.actor);
            this._itemWidgets.push(widget);
        }
    }

    /**
     * Add a section header label.
     */
    _addSectionHeader(text, iconName) {
        const header = new St.BoxLayout({
            style_class: 'recall-section-header',
            x_expand: true,
        });
        header.add_child(new St.Icon({
            style_class: 'recall-section-icon',
            icon_name: iconName,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Label({
            style_class: 'recall-section-label',
            text: text,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._listBox.add_child(header);
    }

    /**
     * Clear all item widgets from the list.
     */
    _clearList() {
        for (const widget of this._itemWidgets) {
            widget.destroy();
        }
        this._itemWidgets = [];
        this._listBox.destroy_all_children();
    }

    /**
     * Handle selecting an entry — copy to clipboard and close.
     */
    _onSelectEntry(id) {
        const entry = this._historyManager.getEntry(id);
        if (!entry) return;

        if (entry.type === 'image' && entry.imagePath) {
            this._clipboardMonitor.setClipboardImage(entry.imagePath);
        } else {
            this._clipboardMonitor.setClipboardText(entry.content);
        }

        this.close();

        // If paste-on-select is enabled, simulate Ctrl+V after a short delay
        if (this._settings.get_boolean('paste-on-select')) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this._simulatePaste();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Handle toggling pin on an entry.
     */
    _onTogglePin(id) {
        this._historyManager.togglePin(id);
    }

    /**
     * Handle deleting an entry.
     */
    _onDeleteEntry(id) {
        this._historyManager.deleteEntry(id);
    }

    /**
     * Show a confirmation dialog before clearing all history.
     */
    _showClearConfirmation() {
        if (this._confirmOverlay) return;

        // Full-screen layer over the dialog; the scrim is a *sibling* of the
        // confirm box so its click handler can't interfere with the buttons.
        this._confirmOverlay = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        const scrim = new St.Widget({
            style_class: 'recall-confirm-backdrop',
            reactive: true,
            x_expand: true,
            y_expand: true,
        });
        scrim.connect('button-press-event', () => {
            this._hideClearConfirmation();
            return Clutter.EVENT_STOP;
        });
        this._confirmOverlay.add_child(scrim);

        const confirmBox = new St.BoxLayout({
            style_class: 'recall-confirm-dialog popup-menu-content',
            vertical: true,
            reactive: true,
            width: 300,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        confirmBox.add_child(new St.Label({
            style_class: 'recall-confirm-title',
            text: 'Clear clipboard history?',
        }));

        const pinnedCount = this._historyManager.getPinnedEntries().length;
        let message = 'This will remove all unpinned clipboard entries.';
        if (pinnedCount > 0) {
            message += ` ${pinnedCount} pinned item${pinnedCount > 1 ? 's' : ''} will be kept.`;
        }
        confirmBox.add_child(new St.Label({
            style_class: 'recall-confirm-message',
            text: message,
        }));

        const btnRow = new St.BoxLayout({
            style_class: 'recall-confirm-buttons',
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
        });

        const cancelBtn = new St.Button({
            style_class: 'recall-confirm-btn-cancel button',
            label: 'Cancel',
            can_focus: true,
        });
        cancelBtn.connect('clicked', () => {
            this._hideClearConfirmation();
        });
        btnRow.add_child(cancelBtn);

        const clearBtn = new St.Button({
            style_class: 'recall-confirm-btn-danger button',
            label: 'Clear All',
            can_focus: true,
        });
        clearBtn.connect('clicked', () => {
            this._historyManager.clearUnpinned();
            this._hideClearConfirmation();
        });
        btnRow.add_child(clearBtn);

        confirmBox.add_child(btnRow);
        this._confirmOverlay.add_child(confirmBox);
        this._container.add_child(this._confirmOverlay);
        cancelBtn.grab_key_focus();
    }

    /**
     * Hide the clear confirmation overlay.
     */
    _hideClearConfirmation() {
        if (this._confirmOverlay) {
            this._confirmOverlay.destroy();
            this._confirmOverlay = null;
            if (this._isOpen)
                this._searchBar.focus();
        }
    }

    /**
     * Simulate a Ctrl+V paste keystroke.
     */
    _simulatePaste() {
        try {
            if (!this._virtualKeyboard) {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._virtualKeyboard = seat.create_virtual_device(
                    Clutter.InputDeviceType.KEYBOARD_DEVICE
                );
            }

            const kb = this._virtualKeyboard;
            const now = GLib.get_monotonic_time();
            kb.notify_keyval(now, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
            kb.notify_keyval(now + 1000, Clutter.KEY_v, Clutter.KeyState.PRESSED);
            kb.notify_keyval(now + 2000, Clutter.KEY_v, Clutter.KeyState.RELEASED);
            kb.notify_keyval(now + 3000, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        } catch (e) {
            console.error(`[Recall] Failed to simulate paste: ${e.message}`);
        }
    }

    /**
     * Whether the dialog is currently open.
     */
    get isOpen() {
        return this._isOpen;
    }

    /**
     * Clean up all resources.
     */
    destroy() {
        this.close();
        this._clearList();
        this._hideClearConfirmation();
        this._virtualKeyboard = null;

        if (this._searchBar) {
            this._searchBar.destroy();
            this._searchBar = null;
        }

        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
            this._container = null;
            this._dialog = null;
            this._backdrop = null;
        }
    }
}
