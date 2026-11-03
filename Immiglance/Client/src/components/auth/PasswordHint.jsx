// The password rule in plain words, shown under every "set a password" field. It mirrors what the server enforces (Backend auth/dynamicPasswordRule.js);
// the server's own message is still what appears if a password is refused.
export default function PasswordHint({ className = "" }) {
  return (
    <p className={`text-xs text-muted-foreground leading-relaxed mb-3 ${className}`}>
      Use at least 8 characters, including one uppercase letter, one lowercase letter, one digit and one special character.
      Allowed special characters: <span className="font-mono">! @ # $ % &amp; * . -</span>
    </p>
  );
}
