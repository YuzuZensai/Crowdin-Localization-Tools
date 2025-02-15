# Crowdin Localization Tools

A userscript that enhances Crowdin's translation editor by providing cross reference from CSV-based translation suggestions.

## Installation

1. First, install a userscript manager for your browser:
   - For Chrome: Install [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - For Firefox: Install [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
   - For Edge: Install [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

2. Click on this link to install the script:
   [Install Crowdin Localization Tools](https://raw.githubusercontent.com/YuzuZensai/Crowdin-Localization-Tools/main/script.js)

3. When prompted by your userscript manager, click "Install" or "OK" to complete the installation.

## Usage

1. Navigate to any Crowdin editor page (URLs matching `https://crowdin.com/editor/*`)
2. The tool will automatically appear as a floating window in the bottom-right corner
3. You can:
   - Toggle the window visibility using the "T" button
   - Drag the window to reposition it
   - Search for translations manually or let it automatically show cross reference data
   - Switch between remote and local CSV files in the settings tab

## Configuration

The tool supports both remote and local CSV files:

- **Remote CSV**: By default, it uses the remote CSV file from this repository
- **Local CSV**: You can upload your own CSV file through the settings tab

The CSV file should follow this format:
```csv
Source,Target,Note
"Original text","Translated text","Optional note"
```

## Updates

The tool can checks for updates. When available:
- A notification will appear
- You can click to visit the repository for the latest version

## Support

For issues, feature requests, or contributions, please visit:
[GitHub Repository](https://github.com/YuzuZensai/Crowdin-Localization-Tools)

## License

This project is open source and available under the MIT License. For more details, see the repository.
