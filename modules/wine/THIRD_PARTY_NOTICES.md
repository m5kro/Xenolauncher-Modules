# Third-Party Notices for the Wine Module

This module is GPL-3.0 licensed. It downloads, installs, and configures third-party runtime components that remain under their own licenses.

## Wine / WineCX

- Component: Wine-compatible runtime, including WineCX builds.
- Current default: `26.1.0-crossover` from `https://github.com/m5kro/winecx-dist`.
- License: Wine is distributed under the GNU Lesser General Public License, version 2.1 or later (`LGPL-2.1-or-later`).
- Source availability: WineCX builds are based on CrossOver source releases from CodeWeavers. See `https://www.codeweavers.com/crossover/source` and the WineCX build scripts at `https://github.com/m5kro/winecx-dist`.
- Modifications: This module does not modify Wine or WineCX source code. At runtime, the module may dynamically patch selected Wine/WineCX app-bundle libraries and DLLs by backing up original files and copying managed DXMT or MoltenVK files into the selected local Wine bundle.
- Notice: WineCX Distributables is not affiliated with or endorsed by CodeWeavers. CrossOver is a CodeWeavers product/mark.

## DXMT

- Component: Direct3D 10/11 translation layer for Metal.
- Current default: `v0.80` from `https://github.com/3Shain/dxmt/releases/tag/v0.80`.
- License for current default: the DXMT `v0.80` release notes state that `v0.80` is the last release distributed under the MIT license.
- License for later releases: DXMT has moved to the GNU Lesser General Public License, version 2.1 (`LGPL-2.1`). See `https://github.com/3Shain/dxmt/blob/main/COPYING.LIB`.
- Source: `https://github.com/3Shain/dxmt`.
- Modifications: This module does not modify DXMT source code.

## DXVK-macOS

- Component: Direct3D 10/11 translation layer for Vulkan.
- Current default: `v1.10.3-20230507-repack` from `https://github.com/Gcenx/DXVK-macOS/releases/tag/v1.10.3-20230507-repack`.
- License: DXVK is distributed under the zlib license.
- Source: `https://github.com/Gcenx/DXVK-macOS` and upstream `https://github.com/doitsujin/dxvk`.
- Modifications: This module does not modify DXVK-macOS source code.

## MoltenVK

- Component: Vulkan implementation layered over Apple Metal.
- Current default: `v1.4.1-privateapi` from `https://github.com/KhronosGroup/MoltenVK/releases/tag/v1.4.1`.
- License: Apache License 2.0.
- Source: `https://github.com/KhronosGroup/MoltenVK`.
- Modifications: This module does not modify MoltenVK source code.
