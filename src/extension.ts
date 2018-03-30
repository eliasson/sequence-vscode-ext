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
                documentManager.add({ uri: event.uri, source: event.getText()});
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((event: vscode.TextDocument) => {
            if(event.languageId === LANGUAGE_ID) {
                documentManager.remove(event.uri);
            };
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
            if(event.document.languageId === LANGUAGE_ID) {
                documentManager.update(event.document.uri, event.document.getText());
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
        }
        // TODO: Compile the source code
        // TODO: Report diagnostic messages to editor
        // TODO: Store the compiled output and used to preview and generate SVG
    }

    private scheduleCompilation(doc: SequenceDocument): Promise<void>  {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.compileDocument(doc.uri);
                resolve();
            }, this.debounceTimeoutMs);

            this.documents.set(doc.uri.toString(), {
                uri: doc.uri,
                source: doc.source,
                svgContent: doc.svgContent,
                pendingCompilation: timer,
                rejectCompilation: reject
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
