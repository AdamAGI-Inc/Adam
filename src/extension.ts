import * as vscode from "vscode";
import { ClaudeDevProvider } from "./providers/ClaudeDevProvider";
import delay from "delay";
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const VSIX_URL = 'https://adamagi.blob.core.windows.net/vscode-extension/adam-vscode.vsix';
const VERSION_URL = 'https://adamagi.blob.core.windows.net/vscode-extension/version.txt';

let outputChannel: vscode.OutputChannel;

async function checkForUpdates(context: vscode.ExtensionContext) {
    const extensionId = 'AdamAI.adam-vscode'; // Replace with your actual extension ID
    const currentVersion = vscode.extensions.getExtension(extensionId)?.packageJSON.version;

    if (!currentVersion) {
        outputChannel.appendLine('Unable to determine current extension version');
        return;
    }

    https.get(VERSION_URL, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            const latestVersion = data.trim();
            if (latestVersion !== currentVersion) {
                vscode.window.showInformationMessage(`A new version (${latestVersion}) of Adam VS Code Extension is available. Would you like to update?`, 'Yes', 'No')
                    .then(selection => {
                        if (selection === 'Yes') {
                            downloadAndInstallUpdate(context);
                        }
                    });
            } else {
                outputChannel.appendLine('Adam VS Code Extension is up to date.');
            }
        });
    }).on('error', (err) => {
        outputChannel.appendLine(`Error checking for updates: ${err.message}`);
    });
}

function downloadAndInstallUpdate(context: vscode.ExtensionContext) {
    const tempPath = path.join(context.globalStorageUri.fsPath, 'adam-vscode-temp.vsix');
    const file = fs.createWriteStream(tempPath);
    https.get(VSIX_URL, (response) => {
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(tempPath))
                .then(() => {
                    fs.unlink(tempPath, () => {});
                    vscode.window.showInformationMessage('Adam VS Code Extension updated. Please reload the window.', 'Reload')
                        .then(selection => {
                            if (selection === 'Reload') {
                                vscode.commands.executeCommand('workbench.action.reloadWindow');
                            }
                        });
                });
        });
    }).on('error', (err) => {
        outputChannel.appendLine(`Error downloading update: ${err.message}`);
        fs.unlink(tempPath, () => {});
    });
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("AdamAGI");
    context.subscriptions.push(outputChannel);

    outputChannel.appendLine("AdamAGI extension activated");

    const sidebarProvider = new ClaudeDevProvider(context, outputChannel);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ClaudeDevProvider.sideBarId, sidebarProvider, {
            webviewOptions: { retainContextWhenHidden: true },
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("claude-dev.plusButtonTapped", async () => {
            outputChannel.appendLine("Plus button tapped");
            await sidebarProvider.clearTask();
            await sidebarProvider.postStateToWebview();
            await sidebarProvider.postMessageToWebview({ type: "action", action: "chatButtonTapped" });
        })
    );

    const openClaudeDevInNewTab = async () => {
        outputChannel.appendLine("Opening AdamAGI in new tab");
        const tabProvider = new ClaudeDevProvider(context, outputChannel);
        const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0));

        const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0;
        if (!hasVisibleEditors) {
            await vscode.commands.executeCommand("workbench.action.newGroupRight");
        }
        const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two;

        const panel = vscode.window.createWebviewPanel(ClaudeDevProvider.tabPanelId, "AdamAGI", targetCol, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri],
        });

        panel.iconPath = {
            light: vscode.Uri.joinPath(context.extensionUri, "icons", "robot_panel_light.png"),
            dark: vscode.Uri.joinPath(context.extensionUri, "icons", "robot_panel_dark.png"),
        };
        tabProvider.resolveWebviewView(panel);

        await delay(100);
        await vscode.commands.executeCommand("workbench.action.lockEditorGroup");
    };

    context.subscriptions.push(vscode.commands.registerCommand("claude-dev.popoutButtonTapped", openClaudeDevInNewTab));
    context.subscriptions.push(vscode.commands.registerCommand("claude-dev.openInNewTab", openClaudeDevInNewTab));

    context.subscriptions.push(
        vscode.commands.registerCommand("claude-dev.settingsButtonTapped", () => {
            sidebarProvider.postMessageToWebview({ type: "action", action: "settingsButtonTapped" });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("claude-dev.historyButtonTapped", () => {
            sidebarProvider.postMessageToWebview({ type: "action", action: "historyButtonTapped" });
        })
    );

    const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
        provideTextDocumentContent(uri: vscode.Uri): string {
            return Buffer.from(uri.query, "base64").toString("utf-8");
        }
    })();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("claude-dev-diff", diffContentProvider)
    );

    // Add auto-update command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.checkForUpdates', () => {
            checkForUpdates(context);
        })
    );

    // Check for updates on activation
    checkForUpdates(context);

    // Set up a daily check for updates
    setInterval(() => checkForUpdates(context), 24 * 60 * 60 * 1000); // Check once a day

    // URI Handler
    const handleUri = async (uri: vscode.Uri) => {
        const path = uri.path;
        const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"));
        const visibleProvider = ClaudeDevProvider.getVisibleInstance();
        if (!visibleProvider) {
            return;
        }
        switch (path) {
            case "/openrouter": {
                const code = query.get("code");
                if (code) {
                    await visibleProvider.handleOpenRouterCallback(code);
                }
                break;
            }
            default:
                break;
        }
    };
    context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }));
}

export function deactivate() {
    outputChannel.appendLine("AdamAGI extension deactivated");
}
