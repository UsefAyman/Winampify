### Mac (test build)

| Your Mac | Download |
|---|---|
| Apple Silicon (M1 or newer) | `Winampify-<version>-arm64.dmg` |
| Intel | `Winampify-<version>-x64.dmg` |

1. Open the `.dmg` and drag **Winampify** to **Applications**.
2. The app isn't signed by Apple yet, so run this once in Terminal:
   ```
   xattr -cr /Applications/Winampify.app
   ```
<!--unsigned-->

> [!WARNING]
> Spotify doesn't play in the Mac build yet. It still needs the castLabs VMP signature.
<!--/unsigned-->

### Linux (test build)

| Distribution | Download |
|---|---|
| Ubuntu / Debian / Mint | `winampify_<version>_amd64.deb` |
| Other Linux (x64) | `Winampify-<version>-x86_64.AppImage` |

- **.deb:** install it with
  ```
  sudo apt install ./winampify_<version>_amd64.deb
  ```
- **AppImage:** make it executable and run it. On Ubuntu 24.04 or newer it may need `--no-sandbox`:
  ```
  chmod +x Winampify-<version>-x86_64.AppImage
  ./Winampify-<version>-x86_64.AppImage --no-sandbox
  ```

### Not on Mac and Linux yet

- Balance
- Automatic updates (download new versions from this Releases page)
- Taskbar preview buttons
