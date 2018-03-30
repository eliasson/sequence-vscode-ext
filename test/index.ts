//
// Sequence VS Code extension- A simple sequence diagram tool
//
// Copyright (C) - markus.eliasson@gmail.com
//
var testRunner = require('vscode/lib/testrunner');

testRunner.configure({
    ui: 'bdd',
    useColors: true
});

module.exports = testRunner;
