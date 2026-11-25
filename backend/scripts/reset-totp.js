const email = process.argv[2];
if (!email) {
    console.error("Usage: node backend/scripts/reset-totp.js <allowed-email>");
    process.exit(1);
}

try {
    const { resetUserTotp } = await import("../routes/auth.js");
    resetUserTotp(email);
    console.log(`Authenticator enrollment reset for ${email.trim().toLowerCase()}.`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
