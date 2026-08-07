# One-checkout Windows and Ubuntu VM development

This setup keeps the Windows checkout as Kizuna's only source tree while a
full Ubuntu desktop VM runs the Linux application. Changes made by Codex or an
editor on Windows appear in the VM immediately. Linux native dependencies,
runtime resources, and build output remain on the VM's virtual disk.

## Recommended VM

Use **Hyper-V** on Windows Pro with **Ubuntu Desktop 24.04.4 LTS (AMD64)**.
This is the deliberate diagnostic baseline: it is a mature LTS release, its
package set is covered by the launcher, and it can run an Ubuntu-on-Xorg
desktop. Use Hyper-V's basic console for the initial visibility test so an RDP
or WSLg window-export layer cannot affect the result.

Suggested VM resources:

- 4 virtual processors
- 8 GB RAM
- 50 GB virtual disk
- Default Switch networking

Download the official `ubuntu-24.04.4-desktop-amd64.iso` from
<https://releases.ubuntu.com/24.04/>. Hyper-V is a Windows feature, so there is
no separate VM application to download.

## 1. Enable Hyper-V and create Ubuntu

1. Search Windows for **Turn Windows features on or off**.
2. Enable **Hyper-V**, including both child items, and restart Windows.
3. Open **Hyper-V Manager** from Start.
4. Select **Quick Create** in the right Actions panel.
5. Select **Local installation source**, select the downloaded Ubuntu ISO, and
   create the VM. Use Generation 2 if Hyper-V asks for a generation.
6. After creation, open the VM's **Settings** and assign 4 processors and 8 GB
   RAM. Use a dynamically expanding 50 GB virtual disk if Hyper-V offers the
   size during creation.
7. In **Settings > Security**, set the Secure Boot template to **Microsoft UEFI
   Certificate Authority**.
8. Connect, start the VM, install Ubuntu, and complete its account setup.
9. At Ubuntu's login screen, select your account, use the gear button, and
   choose **Ubuntu on Xorg** before signing in.

Keep VMConnect in **Basic Session Mode** for the initial proof. Enhanced
Session Mode is convenient later for dynamic resolution, clipboard, and host
audio, but it uses an RDP transport and is therefore a separate result.

## 2. Share the one Windows checkout

SMB is used because it gives the VM a stable, real mount path on which the
launcher can place bind mounts. The repository remains physically at
`E:\Programozás\repos\kizuna`; do not clone it again in Ubuntu.

On Windows:

1. In File Explorer, right-click `E:\Programozás\repos\kizuna` and select
   **Properties > Sharing > Advanced Sharing**.
2. Enable **Share this folder** and use the share name `kizuna`.
3. Under **Permissions**, give your Windows account **Read** and **Change**.
4. If Windows asks, allow **File and Printer Sharing** on private networks.

In Ubuntu, open Terminal and install only the SMB client needed for the first
mount:

```bash
sudo apt-get update
sudo apt-get install -y cifs-utils
sudo mkdir -p /mnt/kizuna
```

Find the Hyper-V host address from Ubuntu. With the Default Switch it is
normally the default gateway:

```bash
ip route | awk '/default/ { print $3; exit }'
```

Mount the share, replacing `HOST_ADDRESS` and `WINDOWS_USER`. Enter the actual
Windows account password when prompted; a Windows Hello PIN is not a password.

```bash
sudo mount -t cifs //HOST_ADDRESS/kizuna /mnt/kizuna \
  -o username=WINDOWS_USER,vers=3.0,uid=$(id -u),gid=$(id -g),file_mode=0777,dir_mode=0777
```

Confirm that this is the existing checkout:

```bash
cd /mnt/kizuna
git status --short
```

If the mount reports `Permission denied`, first try the Windows computer name
instead of the address, for example `//WINDOWS-COMPUTER/kizuna`. Also verify
that the password works for the Windows account and that both the share and
NTFS permissions grant that account access.

### Optional persistent SMB mount

After the first mount works, save the credentials privately:

```bash
mkdir -p ~/.config/kizuna-vm
chmod 700 ~/.config/kizuna-vm
read -rp 'Windows user: ' windows_user
read -rsp 'Windows password: ' windows_password; printf '\n'
printf 'username=%s\npassword=%s\n' "$windows_user" "$windows_password" \
  > ~/.config/kizuna-vm/smb-credentials
chmod 600 ~/.config/kizuna-vm/smb-credentials
unset windows_user windows_password
```

Get the numeric Ubuntu user and group IDs with `id -u` and `id -g`. Then add
this single line to `/etc/fstab`, replacing the uppercase values:

```fstab
//HOST_ADDRESS/kizuna /mnt/kizuna cifs credentials=/home/UBUNTU_USER/.config/kizuna-vm/smb-credentials,vers=3.0,uid=USER_ID,gid=GROUP_ID,file_mode=0777,dir_mode=0777,nofail,x-systemd.automount,_netdev 0 0
```

Test it without rebooting:

```bash
sudo umount /mnt/kizuna
sudo mount /mnt/kizuna
```

## 3. Install and prepare Kizuna

From the shared checkout, run the provided setup. It installs Ubuntu packages,
downloads and verifies the latest Node.js 24 Linux archive from nodejs.org,
creates private VM directories, and runs `npm ci` with Linux native modules.

```bash
cd /mnt/kizuna
bash scripts/vm-dev-shell.sh --install
```

The first run asks for the Ubuntu password several times. It can take several
minutes. Do not run `npm install` directly outside the launcher: the launcher's
bind mounts prevent Linux native packages from overwriting Windows packages.

## Daily workflow

1. Start the Ubuntu VM and ensure `/mnt/kizuna` is mounted.
2. Open Terminal and run:

   ```bash
   cd /mnt/kizuna
   bash scripts/vm-dev-shell.sh --dev
   ```

3. Keep that terminal and Kizuna open.
4. Make changes with Codex on Windows and switch back to the VM. Polling is
   enabled, so Electron/Vite should rebuild and reload shortly after each edit.

The launcher stores Linux-only state under `~/.local/share/kizuna-vm` and bind
mounts it over `node_modules`, `resources`, `out`, `dist`, and `.vite` only
inside Ubuntu. Windows continues to see its own versions of those directories.
The bind mounts are restored automatically each time the launcher starts; sudo
may request the Ubuntu password after a VM reboot. The Windows and VM
development servers may run simultaneously because they have separate network
stacks and private generated output.

## Verification

Run the isolated pixel check first:

```bash
cd /mnt/kizuna
bash scripts/vm-dev-shell.sh
npm run test:linux-visibility
```

Then run `npm run dev` and inspect the actual Ubuntu desktop window while
playing video, opening Settings, moving the window, and resizing it. The pixel
check uses a private X server and is not a substitute for observing the VM's
real desktop compositor.
