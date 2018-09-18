//
// Sequence VS Code extension- A simple sequence diagram tool
//
// Copyright (C) - markus.eliasson@gmail.com
//
'use strict';

import * as vscode from 'vscode';
import * as sequence from '@eliasson/sequence';
import * as fs from 'fs';
export const vscodeUnderTest = vscode;

// This is the VSC internal scheme user for the generated Sequence diagrams
const SCHEME = 'sequence';
const LANGUAGE_ID = 'sequence';
const DIAGRAM_PREVIEW_COLUMN = 2;
const DIAGRAM_EDITOR_TITLE = `Sequence diagram`;

export function activate(context: vscode.ExtensionContext) {
    // Wrapper around how documents and SVG providers are linked
    const documentManager = new DocumentManager();

    // Register our SVG provider used to preview the generated SVG diagrams.
    // Only one provider per scheme can be registered
    const provider = new SVGProvider(documentManager);
    let registration = vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((event: vscode.TextDocument) => {
            if(event.languageId === LANGUAGE_ID) {
                documentManager.add({ uri: event.uri, source: event.getText()})
                    .then(() => {}, () => {});
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((event: vscode.TextDocument) => {
            if(event.languageId === LANGUAGE_ID) {
                documentManager.remove(event.uri)
                    .then(() => {}, () => {});
            };
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
            if(event.document.languageId === LANGUAGE_ID) {
                documentManager.update(event.document.uri, event.document.getText())
                    .then(() => {}, () => {});
            }
        })
    );

    // When the plugin is activated and there are opened and visible editors with sequence
    // code we need to scheuld compile at start, since no other event will be issued by vscode.
    vscode.window.visibleTextEditors.map(editor => {
        if(editor.document.languageId === LANGUAGE_ID) {
            documentManager.add({ uri: editor.document.uri, source: editor.document.getText()})
                .then(() => {}, () => {});
        }
    });

    registerCommands(vscode, documentManager);
}

/**
 * Register commands as part of the bootstrap, but isolated in separate function
 * in order to have testable.
 * 
 * @param commands The namespace handling commands
 */
export function registerCommands(vscModule, documentManager?: DocumentManager) {
    vscModule.commands.registerCommand('sequence.previewSvg', () => {
        const editor = vscModule.window.activeTextEditor;
        if (!editor) {
            vscModule.window.showErrorMessage('Found no active editor!');
            return;
        }

        const doc = editor.document;
        if (doc.languageId !== LANGUAGE_ID) {
            vscModule.window.showInformationMessage('This file is not identified as a Sequence file (.seq).');
            return;
        }
        return vscModule.commands.executeCommand('vscode.previewHtml', 
            constructPreviewUri(editor.document.uri), DIAGRAM_PREVIEW_COLUMN, DIAGRAM_EDITOR_TITLE)
                .then(() => console.log('Sequence shown'), vscModule.window.showErrorMessage);
    });

    vscModule.commands.registerCommand('sequence.saveSvg', () => {
        querySaveActiveDocument(vscModule, documentManager);
    });
}

export function querySaveActiveDocument(vscModule, documentManager: DocumentManager) {
    const editor = vscModule.window.activeTextEditor;
    if (!editor)  {
        vscModule.window.showErrorMessage('Found no active editor!');
        return;
    }

    const doc = editor.document;
    if (doc.languageId !== LANGUAGE_ID) {
        vscModule.window.showInformationMessage('This file is not identified as a Sequence file (.seq).');
        return;
    }

    const sourceUri = vscode.Uri.parse(doc.uri);
    const seqDoc = documentManager.get(sourceUri);

    if (seqDoc.diagnostics && seqDoc.diagnostics.get(seqDoc.uri)) {
        vscModule.window.showInformationMessage('Cannot save a Sequence diagram with errors');
        return
    }

    vscModule.window.showSaveDialog({ filters: { Images: ['svg'] } })
        .then(uri => {
            if (uri) {
                fs.writeFileSync(uri.fsPath, seqDoc.svgContent, 'utf-8');
            }
        });
}

/**
 * Construct a new URI to be consumed by the Sequence SVG provider, with the
 * selected editor URI as a query parameter.
 *
 * @param uri The URI to the document that should be displayed as preview
 */
export function constructPreviewUri(uri: vscode.Uri): vscode.Uri {
    return uri.with({
        scheme: SCHEME,
        path: uri.path + '.svg',
        query: uri.toString()       // Add the source URI as path so it can be extracted in the SVG provider
    });
}

export function deactivate() {
    // None of the examples contains cleanup code. NONE!
}

interface SequenceDocument {
    uri: vscode.Uri;
    source: string;
    svgContent?: string;
    pendingCompilation?: NodeJS.Timer;
    rejectCompilation?: Function
    /* A reference to possible diagnostics registered for this document */
    diagnostics?: vscode.DiagnosticCollection;
}

export class DocumentManager {
    documents = new Map<string, SequenceDocument>();

    constructor(private debounceTimeoutMs=400) {}

    add(doc: SequenceDocument): Promise<void> {
        return this.scheduleCompilation(doc);
    }

    remove(uri: vscode.Uri): Promise<void> {
        let promise = undefined;

        if(this.documents.has(uri.toString())) {
            const doc = this.documents.get(uri.toString());
            this.cancelCompilation(doc);
            promise = this.scheduleCompilation(doc);
        }

        this.documents.delete(uri.toString());
        return promise || Promise.resolve();
    }

    update(uri: vscode.Uri, source: string) {
        let promise;

        if(this.documents.has(uri.toString())) {
            const doc = this.documents.get(uri.toString());
            doc.source = source;

            this.cancelCompilation(doc);
            promise = this.scheduleCompilation(doc);
        }
        return promise || Promise.reject(`No document with uri ${uri} exists!`);
    }

    get(uri: vscode.Uri): SequenceDocument {
        return this.documents.get(uri.toString());
    }

    private compileDocument(uri: vscode.Uri) {
        if(this.documents.has(uri.toString())) {
            const doc = this.documents.get(uri.toString());

            // Only clear the handles, we do not want to reject the given promise!
            if(doc.pendingCompilation) doc.pendingCompilation = undefined;
            if(doc.rejectCompilation) doc.rejectCompilation = undefined;

            // Compile the source and store the produced SVG in the DM
            const compilationResult = sequence.compile(doc.source);
            this.clearDiagnostics(doc);
            if(compilationResult.isValid()) {
                doc.svgContent = compilationResult.output;
            } else {
                this.registerDiagnostics(doc, compilationResult.diagnostics);
            }
        }
    }

    convertDiagnostics(sequenceDiagnostic): vscode.Diagnostic[] {
        const diagnostics = sequenceDiagnostic.map(d => {
            const line = d.line - 1; // VS Code uses 0 based and sequence 1 based
            const symbolLength = d.offendingSymbol ? d.offendingSymbol.length : 1;
            const start = new vscode.Position(line, d.column);
            const end = new vscode.Position(line, d.column + symbolLength);
            return new vscode.Diagnostic(new vscode.Range(start, end), d.message)
        });
        return diagnostics;
    }

    private registerDiagnostics(doc: SequenceDocument, diagnostics) {
        const collection = vscode.languages.createDiagnosticCollection('sequence')
        collection.set(doc.uri, this.convertDiagnostics(diagnostics));
        doc.diagnostics = collection;
        this.documents.set(doc.uri.toString(), doc);
    }

    private clearDiagnostics(doc: SequenceDocument) {
        if(doc.diagnostics) doc.diagnostics.clear();
    }

    private scheduleCompilation(doc: SequenceDocument): Promise<void>  {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.compileDocument(doc.uri);
                resolve();
            }, this.debounceTimeoutMs);

            // TODO: Create a copy-constructor
            this.documents.set(doc.uri.toString(), {
                uri: doc.uri,
                source: doc.source,
                svgContent: doc.svgContent,
                pendingCompilation: timer,
                rejectCompilation: reject,
                diagnostics: doc.diagnostics
            });
        });
    }

    private cancelCompilation(doc: SequenceDocument) {
        if(doc.pendingCompilation) {
            clearTimeout(doc.pendingCompilation);
            doc.pendingCompilation = undefined;
        }
        if(doc.rejectCompilation) {
            doc.rejectCompilation();
            doc.rejectCompilation = undefined;
        }
    }
}

export class SVGProvider implements vscode.TextDocumentContentProvider {
    constructor(private documentManager: DocumentManager) {}

    onDidChange?: vscode.Event<vscode.Uri>;

    provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
        const sourceUri = vscode.Uri.parse(uri.query);
        const doc = this.documentManager.get(sourceUri);

        return new Promise(resolve => {
            resolve(this.wrapAsHtml(doc.svgContent));
        });
    }

    private wrapAsHtml(svgContent: string): string {
        return `<html><head><style>html {box-sizing: border-box;} #diagram {display: flex;}</style></head><body><div id="diagram">${svgContent}</div></body></html>`;
    }
}
