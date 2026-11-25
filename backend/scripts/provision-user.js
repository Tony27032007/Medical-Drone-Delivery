import { stdin, stdout } from "node:process";

const email = process.argv[2];
if (!email) {
    console.error("Usage: node backend/scripts/provision-user.js <allowed-email>");
    process.exit(1);
}

function readHidden(prompt) {
    return new Promise((resolve, reject) => {
        if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
            reject(new Error("Run this command in an interactive terminal."));
            return;
        }

        stdout.write(prompt);
        stdin.setRawMode(true);
        stdin.resume();
        let value = "";

        function finish(error) {
            stdin.removeListener("data", onData);
            stdin.setRawMode(false);
            stdout.write("\n");
            if (error) reject(error);
            else resolve(value);
        }

        function onData(data) {
            for (const character of data.toString()) {
                if (character === "\u0003") {
                    finish(new Error("Cancelled."));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    finish();
                    return;
                }
                if (character === "\u007f" || character === "\b") {
                    value = value.slice(0, -1);
                    continue;
                }
                if (character >= " " && character !== "\u007f") {
                    value += character;
                }
            }
        }

        stdin.on("data", onData);
    });
}

try {
    const first = await readHidden("Password (minimum 12 characters): ");
    const second = await readHidden("Confirm password: ");
    if (first !== second) throw new Error("Passwords do not match.");

    const { createOrUpdateUser } = await import("../routes/auth.js");
    await createOrUpdateUser(email, first);
    console.log(`Account provisioned for ${email.trim().toLowerCase()}.`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
