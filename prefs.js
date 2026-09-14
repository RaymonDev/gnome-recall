/* prefs.js — Preferences window for GNOME Recall
 *
 * GTK4/LibAdwaita preferences UI with organized settings pages.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class RecallPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(520, 680);

        // ========== General Page ==========
        const generalPage = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(generalPage);

        // -- History group --
        const historyGroup = new Adw.PreferencesGroup({
            title: 'History',
            description: 'Configure clipboard history behavior',
        });
        generalPage.add(historyGroup);

        // Max history size
        const maxSizeRow = new Adw.SpinRow({
            title: 'Maximum history size',
            subtitle: 'Entries to keep (5–200); the oldest unpinned entry is removed when full',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 200,
                step_increment: 5,
                page_increment: 25,
                value: settings.get_int('max-history-size'),
            }),
        });
        settings.bind('max-history-size', maxSizeRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        historyGroup.add(maxSizeRow);

        // Clear on boot
        const clearOnBootRow = new Adw.SwitchRow({
            title: 'Clear history on restart',
            subtitle: 'Remove unpinned entries when you log in (pinned entries are kept)',
        });
        settings.bind('clear-on-boot', clearOnBootRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        historyGroup.add(clearOnBootRow);

        // Confirm clear
        const confirmClearRow = new Adw.SwitchRow({
            title: 'Confirm before clearing',
            subtitle: 'Show a confirmation dialog before clearing history',
        });
        settings.bind('confirm-clear', confirmClearRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        historyGroup.add(confirmClearRow);

        // Pinned on top
        const pinnedOnTopRow = new Adw.SwitchRow({
            title: 'Pinned items on top',
            subtitle: 'Display pinned entries above regular history',
        });
        settings.bind('pinned-on-top', pinnedOnTopRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        historyGroup.add(pinnedOnTopRow);

        // -- Notifications group --
        const notifGroup = new Adw.PreferencesGroup({
            title: 'Notifications',
        });
        generalPage.add(notifGroup);

        const notifRow = new Adw.SwitchRow({
            title: 'Notify on copy',
            subtitle: 'Show a notification when content is copied to the clipboard',
        });
        settings.bind('show-notifications', notifRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(notifRow);

        // ========== Appearance Page ==========
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic',
        });
        window.add(appearancePage);

        // -- Preview group --
        const previewGroup = new Adw.PreferencesGroup({
            title: 'Content Preview',
            description: 'How clipboard entries are displayed',
        });
        appearancePage.add(previewGroup);

        // Max preview length
        const previewLenRow = new Adw.SpinRow({
            title: 'Preview length',
            subtitle: 'Maximum characters in text previews (20–500)',
            adjustment: new Gtk.Adjustment({
                lower: 20,
                upper: 500,
                step_increment: 10,
                page_increment: 50,
                value: settings.get_int('max-preview-length'),
            }),
        });
        settings.bind('max-preview-length', previewLenRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        previewGroup.add(previewLenRow);

        // Show timestamps
        const timestampRow = new Adw.SwitchRow({
            title: 'Show timestamps',
            subtitle: 'Display relative time (e.g. "2 min ago") on entries',
        });
        settings.bind('show-timestamps', timestampRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        previewGroup.add(timestampRow);

        // -- Window group --
        const windowGroup = new Adw.PreferencesGroup({
            title: 'Popup Window',
            description: 'Size of the Recall popup',
        });
        appearancePage.add(windowGroup);

        // Width
        const widthRow = new Adw.SpinRow({
            title: 'Window width',
            subtitle: 'Width in pixels (300–800)',
            adjustment: new Gtk.Adjustment({
                lower: 300,
                upper: 800,
                step_increment: 10,
                page_increment: 50,
                value: settings.get_int('window-width'),
            }),
        });
        settings.bind('window-width', widthRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        windowGroup.add(widthRow);

        // Height
        const heightRow = new Adw.SpinRow({
            title: 'Window height',
            subtitle: 'Height in pixels (300–900)',
            adjustment: new Gtk.Adjustment({
                lower: 300,
                upper: 900,
                step_increment: 10,
                page_increment: 50,
                value: settings.get_int('window-height'),
            }),
        });
        settings.bind('window-height', heightRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        windowGroup.add(heightRow);

        // ========== Behavior Page ==========
        const behaviorPage = new Adw.PreferencesPage({
            title: 'Behavior',
            icon_name: 'emblem-system-symbolic',
        });
        window.add(behaviorPage);

        // -- Clipboard group --
        const clipGroup = new Adw.PreferencesGroup({
            title: 'Clipboard',
            description: 'Advanced clipboard behavior',
        });
        behaviorPage.add(clipGroup);

        // Enable images
        const imagesRow = new Adw.SwitchRow({
            title: 'Track images',
            subtitle: 'Store image clipboard entries (screenshots, etc.)',
        });
        settings.bind('enable-images', imagesRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        clipGroup.add(imagesRow);

        // Paste on select
        const pasteRow = new Adw.SwitchRow({
            title: 'Paste on select',
            subtitle: 'Paste into the focused window when you click an entry (otherwise only copies it)',
        });
        settings.bind('paste-on-select', pasteRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        clipGroup.add(pasteRow);

        // Private mode
        const privateRow = new Adw.SwitchRow({
            title: 'Private mode',
            subtitle: 'Pause clipboard monitoring (existing history is preserved)',
        });
        settings.bind('private-mode', privateRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        clipGroup.add(privateRow);

        // ========== Keyboard Page ==========
        const keyboardPage = new Adw.PreferencesPage({
            title: 'Keyboard',
            icon_name: 'input-keyboard-symbolic',
        });
        window.add(keyboardPage);

        // -- Shortcut group --
        const shortcutGroup = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcut',
            description: 'The shortcut to open the Recall popup. Change it via dconf or gsettings.',
        });
        keyboardPage.add(shortcutGroup);

        // Show current shortcut as a read-only row
        const currentShortcut = settings.get_strv('toggle-shortcut');
        const shortcutDisplay = currentShortcut.length > 0 ? currentShortcut[0] : '<Super>v';

        const shortcutRow = new Adw.ActionRow({
            title: 'Toggle shortcut',
            subtitle: `Current: ${shortcutDisplay}`,
            use_markup: false,
        });

        const shortcutLabel = new Gtk.Label({
            label: shortcutDisplay,
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER,
        });
        shortcutRow.add_suffix(shortcutLabel);
        shortcutGroup.add(shortcutRow);

        // Info row
        const infoRow = new Adw.ActionRow({
            title: 'How to change',
            subtitle: 'Run: gsettings set org.gnome.shell.extensions.gnome-recall toggle-shortcut "[\'<Super>v\']"',
            use_markup: false,
        });
        shortcutGroup.add(infoRow);

        // -- Navigation group --
        const navGroup = new Adw.PreferencesGroup({
            title: 'Navigation',
            description: 'Keyboard shortcuts within the popup',
        });
        keyboardPage.add(navGroup);

        const shortcuts = [
            ['↑ / ↓', 'Navigate entries'],
            ['Enter', 'Select and paste entry'],
            ['Escape', 'Close popup / Clear search'],
            ['Type anything', 'Start searching'],
        ];

        for (const [key, desc] of shortcuts) {
            const row = new Adw.ActionRow({
                title: desc,
            });
            const keyLabel = new Gtk.Label({
                label: key,
                css_classes: ['dim-label'],
                valign: Gtk.Align.CENTER,
            });
            row.add_suffix(keyLabel);
            navGroup.add(row);
        }

        // ========== About Page ==========
        const aboutPage = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);

        const aboutGroup = new Adw.PreferencesGroup({
            title: 'Recall — Clipboard History',
            description: `Clipboard history for GNOME Shell.\n\nVersion ${this.metadata['version-name'] ?? ''}\n© 2024–2026 RaymonDev · MIT License`,
        });
        aboutPage.add(aboutGroup);

        const linksGroup = new Adw.PreferencesGroup({
            title: 'Links',
        });
        aboutPage.add(linksGroup);

        const githubRow = new Adw.ActionRow({
            title: 'Source Code',
            subtitle: 'github.com/RaymonDev/gnome-recall',
            activatable: true,
        });
        githubRow.add_suffix(new Gtk.Image({
            icon_name: 'external-link-symbolic',
            valign: Gtk.Align.CENTER,
        }));
        linksGroup.add(githubRow);
    }
}
