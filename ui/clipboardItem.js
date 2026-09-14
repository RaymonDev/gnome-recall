import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

const TYPE_ICONS = {
    text: 'edit-paste-symbolic',
    link: 'web-browser-symbolic',
    color: 'color-select-symbolic',
    image: 'image-x-generic-symbolic',
};

//"5s ago", "3h ago", older than a week just shows the date
function formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = Math.floor((now - timestamp) / 1000);

    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

    const date = new Date(timestamp);
    const month = date.toLocaleString('default', { month: 'short' });
    return `${month} ${date.getDate()}`;
}

//collapse newlines/whitespace so multi line copies fit on one row
function truncateText(text, maxLength) {
    let clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length > maxLength) {
        return clean.substring(0, maxLength) + '…';
    }
    return clean;
}

//one row in the list: icon, preview text, meta line, pin + delete buttons
export class ClipboardItemWidget {
    constructor(opts) {
        this.entry = opts.entry;
        this._maxPreviewLength = opts.maxPreviewLength || 100;
        this._showTimestamps = opts.showTimestamps !== false;
        this._isActive = opts.isActive || false;
        this._onSelect = opts.onSelect || (() => {});
        this._onPin = opts.onPin || (() => {});
        this._onDelete = opts.onDelete || (() => {});

        this._build();
    }

    _build() {
        const entry = this.entry;

        let styleClass = 'recall-item popup-menu-item';
        if (this._isActive) styleClass += ' recall-item-active';
        if (entry.pinned) styleClass += ' recall-item-pinned';

        //deliberately not an St.Button, nesting buttons breaks clicks on gnome 47+ (parent gesture wins)
        this.actor = new St.BoxLayout({
            style_class: styleClass,
            x_expand: true,
            can_focus: true,
            track_hover: true,
            reactive: true,
        });

        //fake the :active state ourselves since this isnt a real button
        this.actor.connect('button-press-event', () => {
            this.actor.add_style_pseudo_class('active');
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('button-release-event', (_actor, event) => {
            this.actor.remove_style_pseudo_class('active');
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            //event.get_source() is null for mouse events on mutter 50, so check coords against the buttons area
            const [x, y] = event.get_coords();
            const actionsRect = this._actionsBox.get_transformed_extents();
            if (actionsRect.contains_point(new Graphene.Point({x, y})))
                return Clutter.EVENT_PROPAGATE;
            this._onSelect(entry.id);
            return Clutter.EVENT_PROPAGATE;
        });

        this.actor.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._onSelect(entry.id);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        const hbox = new St.BoxLayout({
            style_class: 'recall-item-content',
            x_expand: true,
            vertical: false,
        });
        this.actor.add_child(hbox);

        const iconName = TYPE_ICONS[entry.type] || TYPE_ICONS.text;
        let iconStyleClass = 'recall-item-icon';
        if (entry.type === 'image') iconStyleClass += ' recall-item-icon-image';
        else if (entry.type === 'link') iconStyleClass += ' recall-item-icon-link';
        else if (entry.type === 'color') iconStyleClass += ' recall-item-icon-color';

        const icon = new St.Icon({
            icon_name: iconName,
            style_class: iconStyleClass,
            y_align: Clutter.ActorAlign.START,
        });
        hbox.add_child(icon);

        //little color square next to hex/rgb values
        if (entry.type === 'color') {
            const swatch = new St.Widget({
                style_class: 'recall-color-swatch',
                style: `background-color: ${entry.content.trim()};`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            hbox.add_child(swatch);
        }

        const contentBox = new St.BoxLayout({
            style_class: 'recall-item-text-container',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        hbox.add_child(contentBox);

        let previewText, previewStyleClass;
        if (entry.type === 'image') {
            previewText = entry.preview || 'Image';
            previewStyleClass = 'recall-item-preview recall-item-preview-image';
        } else {
            previewText = truncateText(entry.content, this._maxPreviewLength);
            previewStyleClass = 'recall-item-preview';
        }

        const previewLabel = new St.Label({
            style_class: previewStyleClass,
            text: previewText,
            x_expand: true,
        });
        previewLabel.clutter_text.ellipsize = 3;
        previewLabel.clutter_text.line_wrap = false;
        contentBox.add_child(previewLabel);

        const metaBox = new St.BoxLayout({
            style_class: 'recall-item-meta',
            vertical: false,
        });
        contentBox.add_child(metaBox);

        if (this._showTimestamps) {
            const timeLabel = new St.Label({
                style_class: 'recall-item-timestamp',
                text: formatRelativeTime(entry.timestamp),
            });
            metaBox.add_child(timeLabel);
        }

        if (entry.type === 'link') {
            const badge = new St.Label({
                style_class: 'recall-item-type-badge',
                text: 'URL',
            });
            metaBox.add_child(badge);
        } else if (entry.type === 'color') {
            const badge = new St.Label({
                style_class: 'recall-item-type-badge',
                text: 'Color',
            });
            metaBox.add_child(badge);
        } else if (entry.type === 'image') {
            const badge = new St.Label({
                style_class: 'recall-item-type-badge',
                text: 'Image',
            });
            metaBox.add_child(badge);
        }

        //filled star in the accent color when pinned
        if (entry.pinned) {
            metaBox.add_child(new St.Icon({
                style_class: 'recall-item-pin-badge',
                icon_name: 'starred-symbolic',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        const actionsBox = new St.BoxLayout({
            style_class: 'recall-item-actions',
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._actionsBox = actionsBox;
        hbox.add_child(actionsBox);

        const pinBtn = new St.Button({
            style_class: entry.pinned ?
                'recall-action-btn recall-action-btn-pinned' :
                'recall-action-btn recall-action-btn-pin',
            can_focus: true,
            child: new St.Icon({
                icon_name: entry.pinned ? 'starred-symbolic' : 'non-starred-symbolic',
                style_class: 'recall-action-btn-icon',
            }),
        });
        pinBtn.connect('clicked', () => {
            this._onPin(entry.id);
            return Clutter.EVENT_STOP;
        });
        actionsBox.add_child(pinBtn);

        const deleteBtn = new St.Button({
            style_class: 'recall-action-btn recall-action-btn-delete',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'edit-delete-symbolic',
                style_class: 'recall-action-btn-icon',
            }),
        });
        deleteBtn.connect('clicked', () => {
            this._onDelete(entry.id);
            return Clutter.EVENT_STOP;
        });
        actionsBox.add_child(deleteBtn);
    }

    destroy() {
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}
