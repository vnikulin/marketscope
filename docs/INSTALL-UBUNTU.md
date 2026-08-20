# Install on Ubuntu

MarketScope supports 64-bit Ubuntu 22.04, 24.04, and 26.04 on AMD64 and ARM64.
The machine needs at least 2 GB of RAM, 10 GB of free disk space, Internet
access, and either `curl` or `wget` for the first command.

Publish a semantic version release first. The release workflow builds the
container and installer assets. The linked GHCR container package must be
public so the Ubuntu server can pull it without storing a GitHub credential.

For a clean-machine release test, publish a prerelease such as `v0.1.0-rc.1`.
Prereleases keep their own container tag and don't replace the stable `latest`
tag. Install that exact prerelease instead of the latest stable release:

```bash
curl -fsSL https://github.com/<owner>/<repository>/releases/download/v0.1.0-rc.1/install.sh | sudo bash
```

Install the latest release with `curl`:

```bash
curl -fsSL https://github.com/<owner>/<repository>/releases/latest/download/install.sh | sudo bash
```

If the image has no `curl`, use `wget`:

```bash
wget -qO- https://github.com/<owner>/<repository>/releases/latest/download/install.sh | sudo bash
```

The installer checks the operating system, CPU architecture, RAM, disk, and
network before changing the machine. It installs Docker from Docker's official
APT repository, enables Docker at boot, creates the persistent directories,
generates a session signing key, starts MarketScope, and runs a health check.

The default server binds to `127.0.0.1:3000`. Accept the Tailscale option to
publish that loopback listener privately over HTTPS. If you choose LAN HTTP,
rerun the installer and choose `reconfigure`, then enter `0.0.0.0` as the bind
address. LAN HTTP doesn't support PWA installation. The installer never
disables or changes UFW.

After installation:

```bash
sudo marketscope status
sudo marketscope diagnose
sudo marketscope logs -f
```

Rerunning the installer offers `upgrade`, `repair`, `reconfigure`, or `cancel`.
None of those choices deletes the database.
