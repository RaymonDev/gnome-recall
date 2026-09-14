/* ui/searchBar.js — Search bar component for GNOME Recall
 *
 * A text input with search icon, real-time filtering,
 * and match count display.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';

/**
 * SearchBar — Search input with result count.
 */
export class SearchBar {
    /**
     * @param {object} opts
     * @param {function(string)} opts.onSearch — Called on every text change with the query string
     */
    constructor(opts = {}) {
        this._onSearchCallback = opts.onSearch || (() => {});

        // Container
        this.actor = new St.BoxLayout({
            style_class: 'recall-search-container',
            vertical: true,
            x_expand: true,
        });

        // Row with search entry and count label
        const row = new St.BoxLayout({
            x_expand: true,
            vertical: false,
        });

        // Search entry
        this.entry = new St.Entry({
            style_class: 'recall-search-entry search-entry',
            hint_text: 'Search clipboard history…',
            can_focus: true,
            track_hover: true,
            x_expand: true,
            primary_icon: new St.Icon({
                icon_name: 'edit-find-symbolic',
                style_class: 'recall-search-icon',
            }),
        });

        this.entry.get_clutter_text().connect('text-changed', () => {
            this._onSearchCallback(this.entry.get_text());
        });

        // Handle Escape key to clear search
        this.entry.get_clutter_text().connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape) {
                if (this.entry.get_text().length > 0) {
                    this.entry.set_text('');
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        row.add_child(this.entry);
        this.actor.add_child(row);
    }

    /**
     * Clear the search text.
     */
    clear() {
        this.entry.set_text('');
    }

    /**
     * Focus the search entry.
     */
    focus() {
        global.stage.set_key_focus(this.entry);
    }

    /**
     * Get current search text.
     */
    getText() {
        return this.entry.get_text();
    }

    /**
     * Clean up.
     */
    destroy() {
        this.actor.destroy();
    }
}
