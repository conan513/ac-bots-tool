# AzerothCore & mod-playerbots Build Helper Dashboard

Egy rendkívül egyszerűen használható, de dizájnos web-alapú kezelőfelület (Dashboard), ami segít letölteni, konfigurálni és lefordítani az AzerothCore szervert a `mod-playerbots` modullal integrálva Windows, Linux és macOS rendszereken.

A függőségeket teljesen **portable (hordozható)** módon tudja letölteni és konfigurálni, így nem szennyezi be a rendszeredet globális változókkal vagy telepítésekkel.

## Hogyan működik?

1. **Rendszer-szintű fordító:** A tool segít telepíteni a C++ fordítóprogramot (Windows-on a Visual Studio Build Toolst `winget` segítségével, macOS-en az Xcode-ot `xcode-select`-tel).
2. **Hordozható függőségek (CMake, Boost, OpenSSL, MariaDB):** Egy kattintással letölti a legfrissebb CMake-et a `deps/` mappába, majd a `vcpkg` segítségével lokálisan fordítja le a szükséges Boost és OpenSSL könyvtárakat.
3. **Automatizált klónozás és buildelés:**
   - Letölti az azerothcore-wotlk repository-t.
   - Letölti a mod-playerbots modult a `modules` mappába.
   - Lefuttatja a CMake konfigurációt a helyi függőségekre mutatva.
   - Elindítja a párhuzamos fordítást (minden processzormagot kihasználva) a végleges szerver binárisok elkészítéséhez.
4. **Valós idejű logok:** A böngészőből követheted a teljes fordítási folyamatot színkódolt, szűrhető konzolon keresztül.

---

## Indítás lépései

### 1. Letöltés és futtatás
Nyisd meg a projekt gyökérkönyvtárát, és indítsd el a rendszerednek megfelelő fájlt:
- **Windows:** Dupla kattintás a `start.bat` fájlra.
- **Linux / macOS:** Futtasd a `bash start.sh` parancsot a terminálban.

A parancsfájl automatikusan telepíti a háttér és felület függőségeit az első indításkor, lefordítja a kezelőfelületet, majd elindítja a helyi szervert és megnyitja a böngészőt a `http://localhost:3000` címen.

---

## Technikai részletek

- **Kezelőfelület (Frontend):** React, Vite, TypeScript és egyedi Vanilla CSS (üveg/neon sötét dizájn, teljesen reszponzív).
- **Kiszolgáló (Backend):** Node.js + Express, Server-Sent Events (SSE) a logok streamelésére.
- **Függőségek:** A letöltött hordozható eszközök a `deps/` mappába kerülnek. A lefordított szerver a `azerothcore/bin/` mappában fog elkészülni.
