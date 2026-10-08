Build Scraper for Windows
=========================

Double-click BuildScraper.exe. Everything opens in one window:

  From a world    Pull a build out of a Minecraft Java world (1.12.2 to latest).
  Convert files   Turn .schematic / .litematic / .nbt / .schem files into the format you need.
  Search the web  Search GitHub or a website by words and/or a category (Houses, Castles,
                  Towers, Redstone, ...). Results are tagged with a category.
  My builds       Every build you save, sorted into category folders. Search them, filter by
                  category, move a build to another category, or open it in 3D.
  View in 3D      The schematic viewer.

Saving
  Save puts the build in Documents\Minecraft Builds\<Category>\. The category is guessed
  from the name (castle-keep -> Castles & Medieval) and you can change it or type your own;
  a new category becomes a new folder. "Change folder" on the My builds tab picks another
  place. Nothing is ever overwritten: a second castle.schem is saved as castle-2.schem.

First start: Windows may say "Windows protected your PC" because the app is new and not
code-signed. Click "More info" and then "Run anyway".

Needs Windows 10 or 11 (64-bit) with the Microsoft Edge WebView2 Runtime, which comes with
Windows. Without it, Build Scraper opens in your web browser instead.

Web searches and downloads are made by the app, one page at a time per site, and pages a
site's robots.txt rules out are skipped. Please follow each site's rules.

If something goes wrong: the Problems button in the app lists what happened. Problems are
also saved to %LOCALAPPDATA%\BuildScraper\BuildScraper-errors.txt.
