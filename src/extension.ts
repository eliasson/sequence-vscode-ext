//
// Sequence VS Code extension- A simple sequence diagram tool
//
// Copyright (C) - markus.eliasson@gmail.com
//
'use strict';

import * as vscode from 'vscode';
import * as sequence from '@eliasson/sequence';
export const vscodeUnderTest = vscode;

// This is the VSC internal scheme user for the generated Sequence diagrams
const SCHEME = 'sequence';
const LANGUAGE_ID = 'sequence';

export function activate(context: vscode.ExtensionContext) {
    // Wrapper around how documents and SVG providers are linked
    const documentManager = new DocumentManager(); 

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

    context.subscriptions.push(
        vscode.commands.registerCommand('sequence.previewSvg', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const doc = editor.document;
            if (doc.languageId !== LANGUAGE_ID) {
                vscode.window.showInformationMessage('This file is not identified as a Sequence file (.seq).');
                return;
            }
            vscode.window.showInformationMessage('Not yet implemented');
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
    diagnostics?: any;
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

    private compileDocument(uri: vscode.Uri) {
        if(this.documents.has(uri.toString())) {
            const doc = this.documents.get(uri.toString());

            // Only clear the handles, we do not want to reject the given promise!
            if(doc.pendingCompilation) doc.pendingCompilation = undefined;
            if(doc.rejectCompilation) doc.rejectCompilation = undefined;

            // Compile the source and store the produced SVG in the DM
            const compilationResult = sequence.compile(doc.source);
            if(compilationResult.isValid()) {
                doc.svgContent = compilationResult.output;
                this.clearDiagnostics(doc);
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
