//
// Sequence VS Code extension- A simple sequence diagram tool
//
// Copyright (C) - markus.eliasson@gmail.com
//
import 'mocha';
import * as chai from 'chai';
import * as spies from 'chai-spies';
import * as vscode from 'vscode';
import * as extension from '../src/extension';

const expect = chai.expect;
chai.use(spies);

class StubExtensionContext implements vscode.ExtensionContext {
    subscriptions: { dispose(): any; }[] = new Array();
    workspaceState: vscode.Memento;
    globalState: vscode.Memento;
    extensionPath: string;
    asAbsolutePath(relativePath: string): string {
        throw new Error("Method not implemented.");
    }
    storagePath: string;
}

const DEBOUCE_TIMEOUT_MS = 1;
const SOURCE = 'Name Unit-test';
const UPDATED_SOURCE = 'Name Unit-test\nActor Alice';

const newDM = () => new extension.DocumentManager(DEBOUCE_TIMEOUT_MS);
const newUri = (name) => vscode.Uri.parse(`sequence://example/${name}`);
const newDoc = (name) => { return { uri: newUri(name), source: SOURCE } };

describe('Extension', () => {
    let context,
        registerCommandSpy,
        registerProviderSpy;

    beforeEach(() => {
        context = new StubExtensionContext();
        registerCommandSpy = chai.spy(extension.vscodeUnderTest.commands.registerCommand);
        registerProviderSpy = chai.spy(extension.vscodeUnderTest.workspace.registerTextDocumentContentProvider)
        extension.activate(context);
    });

    afterEach(() => {
        // VSCode does some (unknown) cleanup at deactivation. Try to mimic this
        // else commads fails to register on second test.
        context.subscriptions.forEach(it => it.dispose());
    });

    it('should be loaded', () => {
        expect(vscode.extensions.getExtension('markuseliasson.sequence-vscode-ext')).to.not.be.undefined;
    });

    xit('should register compile command', () => {
        expect(registerCommandSpy).to.have.been.called.with('sequence.previewSvg');
    });
});

describe('DocumentManager', () => {
    describe('at construction', () => {
        let dm;

        beforeEach(() => {
            dm = newDM();
        });

        it('should not contain any documents at first', () => {
            expect(dm.documents.size).to.equal(0);
        });
    });

    describe('when adding a document', () => {
        let compileDocument,
            doc,
            dm;

        beforeEach(() => {
            doc = newDoc('one.seq');
            dm = newDM();
            compileDocument = chai.spy.on(dm, 'compileDocument');
        });

        it('one document should be added', (done) => {
            dm.add(doc)
                .then(() => {
                    expect(dm.documents.size).to.equal(1);
                    done();
                });
            
        });

        it('should eventually call `compileDocument`', (done) => {
            dm.add(doc)
                .then(() => {
                    expect(compileDocument).to.have.been.called.with(doc.uri);
                    done();
                });
        });
    });

    describe('removing a document', () => {
        let dm;

        beforeEach(() => {
            dm = newDM();
        });

        it('one document should be removed', (done) => {
            dm.add(newDoc('one.seq'))
                .then(() => dm.add(newDoc('two.seq')))
                .then(() => dm.remove(newUri('one.seq')))
                .then(() => {
                    expect(dm.documents.size).to.equal(1);
                    done();
                });
        });

        it('should cancel ongoing compilation', (done) => {
            dm.add(newDoc('one.seq'))
                .then(() => { /* success */ }, done);
            dm.remove(newUri('one.seq'));
        });
    });

    describe('updating a document', () => {
        let compileDocument,
            doc,
            dm;

        beforeEach(() => {
            doc = newDoc('one.seq');
            dm = newDM();
            compileDocument = chai.spy.on(dm, 'compileDocument');
        });

        it('should eventually call `compileDocument`', (done) => {
            dm.add(doc)
                .then(() => {
                    return dm.update(doc.uri, UPDATED_SOURCE);
                })
                .then(() => {
                    expect(compileDocument).to.have.been.called.with(doc.uri);
                    done();
                });
        });

        it('should cancel a already scheduled compilation', () => {
            return new Promise((resolve, reject) => {
                const promiseToAdd = dm.add(doc);
                const promiseToUpdate = dm.update(doc.uri, UPDATED_SOURCE);
                promiseToUpdate
                    .then(() => {
                        promiseToAdd.then(reject, resolve)
                    });
            });
        });

        it('should update the document immediately', (done) => {
            dm.add(doc)
                .then(() => {
                    // Check the document status immediately, but don't complete
                    // the test-case until the promise is fulfilled
                    const promiseToUpdate = dm.update(doc.uri, UPDATED_SOURCE);
                    const updatedDoc = dm.documents.values().next().value;
                    expect(updatedDoc.source).to.equal(UPDATED_SOURCE);

                    return promiseToUpdate;
                })
                .then(done);
        });

        it('should fail to update a non-existing document', () => {
            return new Promise((resolve, reject) => {
                dm.update(newUri('missing'), UPDATED_SOURCE)
                    .then(reject, resolve); // Switched since failure is expected
            });
        });
    });
});
