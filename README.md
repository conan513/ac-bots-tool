# AzerothCore & mod-playerbots Build Helper Dashboard

An extremely easy-to-use, styled web-based dashboard designed to help you download, configure, and compile the AzerothCore server integrated with the `mod-playerbots` module on Windows, Linux, and macOS.

It downloads and configures dependencies in a completely **portable** manner, ensuring your system is not cluttered with global variables or installations.

## How does it work?

1. **System-level compiler:** The tool helps install the C++ compiler (Visual Studio Build Tools via `winget` on Windows, Xcode command line tools via `xcode-select` on macOS).
2. **Portable dependencies (CMake, Boost, OpenSSL, MariaDB):** With one click, it downloads the latest CMake to the `deps/` folder, then uses `vcpkg` to compile the required Boost and OpenSSL libraries locally.
3. **Automated cloning and building:**
   - Clones the azerothcore-wotlk repository.
   - Clones the mod-playerbots module into the `modules` folder.
   - Runs the CMake configuration pointing to the local dependencies.
   - Launches parallel compilation (utilizing all CPU cores) to produce the final server binaries.
4. **Real-time logs:** You can monitor the entire compilation process from your browser via a color-coded, filterable console.

---

## Launch Steps

### 1. Download and run
Open the root directory of the project and run the file corresponding to your operating system:
- **Windows:** Double-click the `start.bat` file.
- **Linux / macOS:** Run the `bash start.sh` command in your terminal.

The startup script automatically installs backend and frontend dependencies on the first run, builds the interface, starts the local server, and opens your browser at `http://localhost:3000`.

---

## Technical Details

- **Frontend:** React, Vite, TypeScript, and custom Vanilla CSS (glassmorphism/neon dark design, fully responsive).
- **Backend:** Node.js + Express, Server-Sent Events (SSE) for log streaming.
- **Dependencies:** Downloaded portable tools are stored in the `deps/` folder. The compiled server binaries will be created in the `azerothcore/bin/` folder.
