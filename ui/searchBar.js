import Clutter from 'gi://Clutter';
import St from 'gi://St';

//search box at the top of the popup, calls onSearch on every keystroke
export class SearchBar {
    constructor(opts = {}) {
        this._onSearchCallback = opts.onSearch || (() => {});

        this.actor = new St.BoxLayout({
            style_class: 'recall-search-container',
            vertical: true,
            x_expand: true,
        });

        const row = new St.BoxLayout({
            x_expand: true,
            vertical: false,
        });

        //search-entry class = same pill style as the activities search
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

        //esc clears the text first, if its already empty we let it bubble up and close the popup
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

    clear() {
        this.entry.set_text('');
    }

    focus() {
        global.stage.set_key_focus(this.entry);
    }

    getText() {
        return this.entry.get_text();
    }

    destroy() {
        this.actor.destroy();
    }
}
