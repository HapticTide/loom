# Contract: Hello World CLI

## Goal
Implement a Node.js CLI tool that outputs greeting messages.

## Acceptance Criteria

### AC-01: Default greeting
- **Description**: Running the tool without arguments outputs "Hello, World!"
- **Verification**: `node index.js`
- **Expected output**: `Hello, World!`

### AC-02: Custom name greeting
- **Description**: Running the tool with --name flag outputs personalized greeting
- **Verification**: `node index.js --name Alice`
- **Expected output**: `Hello, Alice!`

### AC-03: Package.json exists
- **Description**: A valid package.json file exists
- **Verification**: `node -e "const p = require('./package.json'); console.log(p.name)"`
- **Expected output**: `hello-world-cli`

## Deliverables
- index.js
- package.json
