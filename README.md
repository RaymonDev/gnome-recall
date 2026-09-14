<div align="center">

# recall

### Clipboard history for GNOME Shell

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46%20%E2%80%93%2050-4a86cf.svg?style=flat-square&logo=gnome&logoColor=white)](#compatibility)
[![Ubuntu](https://img.shields.io/badge/Ubuntu-24.04%20%E2%80%93%2026.04-E95420.svg?style=flat-square&logo=ubuntu&logoColor=white)](#compatibility)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](#contributing)

[Installation](#installation) • [Usage](#usage) • [Configuration](#configuration) • [Compatibility](#compatibility) • [Troubleshooting](#troubleshooting) • [Contributing](#contributing)

</div>

---

## What is recall?

**`recall`** is a clipboard history manager for GNOME Shell. It records everything you copy and puts it one keystroke away: press <kbd>Super</kbd> + <kbd>V</kbd> to open a searchable list of your clipboard history, pin the entries you want to keep, and paste any of them straight into the window you were working in.

It is built with GNOME Shell's own UI toolkit and theme classes, so it looks and behaves like a native part of the desktop:

- **Instant access** — <kbd>Super</kbd> + <kbd>V</kbd> opens the history on top of any application.
- **Search as you type** — the list filters in real time as soon as you start typing.
- **Paste on select** — click an entry or press <kbd>Enter</kbd> and it is pasted into the focused window.
- **Pinned entries** — star anything you want to keep; pinned entries survive restarts and *Clear All*.
- **Image support** — screenshots and copied images are captured alongside text.
- **Content detection** — URLs and color codes are recognized and labeled, with a live swatch for colors.
- **Keyboard-driven** — full navigation with arrow keys, <kbd>Enter</kbd>, <kbd>Tab</kbd> and <kbd>Esc</kbd>.
- **Private mode** — pause tracking at any time without touching existing history.
- **Native look** — follows your theme, light/dark mode and accent color automatically. Works on Wayland and X11.

---

## Installation

### From source

```bash
git clone https://github.com/RaymonDev/gnome-recall.git
cd gnome-recall

glib-compile-schemas schemas/
ln -sfn "$(pwd)" ~/.local/share/gnome-shell/extensions/gnome-recall@raymondev
```

Reload GNOME Shell so the extension is picked up:

- **Wayland** (Ubuntu default): log out and log back in.
- **X11**: press <kbd>Alt</kbd> + <kbd>F2</kbd>, type `r`, press <kbd>Enter</kbd>.

Then enable it:

```bash
gnome-extensions enable gnome-recall@raymondev
```

You can also enable it from the **Extensions** app or [Extension Manager](https://github.com/mjakeman/extension-manager).

> **Note:** if another shortcut already uses <kbd>Super</kbd> + <kbd>V</kbd> (for example a custom shortcut under *Settings → Keyboard*), it takes precedence and recall will not open. Remove that shortcut or give recall a different one — see [Changing the shortcut](#changing-the-shortcut).

---

## Usage

| Input | Action |
| :--- | :--- |
| <kbd>Super</kbd> + <kbd>V</kbd> | Open or close recall |
| Type anything | Filter the history |
| <kbd>↑</kbd> / <kbd>↓</kbd> / <kbd>Tab</kbd> | Move between entries |
| <kbd>Enter</kbd> | Paste the selected entry |
| <kbd>Esc</kbd> | Clear the search, then close |
| Click outside | Close |

Each entry has two actions: **star** to pin or unpin it, and **delete** to remove it. The header holds **Clear All**, which removes every unpinned entry (with confirmation), and a **gear** button that opens the preferences.

---

## Configuration

Open the preferences from the gear button in the popup, from the Extensions app, or from a terminal:

```bash
gnome-extensions prefs gnome-recall@raymondev
```

| Setting | Default | Description |
| :--- | :---: | :--- |
| **Maximum history size** | 50 | Entries to keep (5–200). When full, the oldest unpinned entry is removed. |
| **Clear history on restart** | On | Remove unpinned entries when you log in. Pinned entries are always kept. |
| **Paste on select** | On | Paste into the focused window after selecting. Off = copy to clipboard only. |
| **Pinned items on top** | On | Show pinned entries in their own section above the rest. |
| **Confirm before clearing** | On | Ask before *Clear All* removes your history. |
| **Track images** | On | Capture images and screenshots, not just text. |
| **Show timestamps** | On | Show relative time (“2m ago”) on each entry. |
| **Preview length** | 100 | Maximum characters shown per entry (20–500). |
| **Private mode** | Off | Pause clipboard tracking. |
| **Notify on copy** | Off | Show a notification whenever something is copied. |
| **Window width / height** | 420 × 520 | Size of the popup, in pixels. |

### Changing the shortcut

The toggle shortcut is stored in GSettings. To bind it to <kbd>Super</kbd> + <kbd>C</kbd>, for example:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/gnome-recall@raymondev/schemas \
  set org.gnome.shell.extensions.gnome-recall toggle-shortcut "['<Super>c']"
```

The change applies immediately.

---

## Compatibility

| Distribution | GNOME Shell | Status |
| :--- | :---: | :---: |
| Ubuntu 26.04 LTS | 50 | Supported |
| Ubuntu 25.10 | 49 | Supported |
| Ubuntu 25.04 | 48 | Supported |
| Ubuntu 24.10 | 47 | Supported |
| Ubuntu 24.04 LTS | 46 | Supported |

Any distribution shipping GNOME Shell 46 through 50 should work. Wayland and X11 sessions are both supported.

---

## Privacy

recall keeps its history locally in `~/.cache/gnome-recall/` — `history.json` for entries and `images/` for captured images. Nothing is sent anywhere. Deleting that directory removes all stored history, and **Private mode** stops new entries from being recorded without touching what is already there.

---

## Troubleshooting

**Nothing happens when I press Super + V**
Check for a conflicting shortcut under *Settings → Keyboard → Keyboard Shortcuts → Custom Shortcuts*, and confirm the extension is enabled: `gnome-extensions info gnome-recall@raymondev` should report `State: ACTIVE`.

**The extension is enabled but the popup never appears**
Extension code is loaded once, at login. On Wayland, log out and back in after installing or updating.

**Paste on select does not paste into a terminal**
Most terminals use <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>V</kbd> instead of <kbd>Ctrl</kbd> + <kbd>V</kbd>. The entry is still on the clipboard — paste it with the terminal's own shortcut.

**Viewing the logs**

```bash
journalctl --user -f -o cat | grep -iE "recall|JS ERROR"
```

---

## Development

```
gnome-recall/
├── extension.js          Entry point: wiring, keybinding, lifecycle
├── clipboard.js          Clipboard monitoring (Meta.Selection / St.Clipboard)
├── historyManager.js     Persistence, pinning, search, size limits
├── prefs.js              GTK 4 / libadwaita preferences window
├── stylesheet.css        Popup styling, built on the Shell's theme classes
├── metadata.json         Extension metadata
├── ui/
│   ├── recallDialog.js   The popup: layout, modal grab, keyboard handling
│   ├── clipboardItem.js  A single history row
│   └── searchBar.js      Search entry
└── schemas/              GSettings schema (compile with glib-compile-schemas)
```

- After editing the schema, run `glib-compile-schemas schemas/`.
- After editing JavaScript, log out and back in — `gnome-extensions disable` / `enable` reloads the stylesheet but not the code.

To build the bundle for [extensions.gnome.org](https://extensions.gnome.org):

```bash
gnome-extensions pack -f -o dist \
  --extra-source=clipboard.js --extra-source=historyManager.js \
  --extra-source=ui --extra-source=LICENSE \
  "$(pwd)"
```

The popup is built on GNOME Shell's own style classes (`popup-menu-content`, `popup-menu-item`, `search-entry`, `button`), so it inherits the active theme, light/dark mode and accent color with no hard-coded colors.

---

## Contributing

Contributions, issues and feature requests are welcome. Please open an issue or pull request on the [issues page](https://github.com/RaymonDev/gnome-recall/issues). When reporting a problem, include your GNOME Shell version (`gnome-shell --version`), whether you are on Wayland or X11, and any relevant lines from the log.

---

## License

This project is licensed under the [MIT License](LICENSE) — see the [LICENSE](LICENSE) file for details.
