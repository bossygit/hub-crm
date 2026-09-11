export const PASSWORD_RULES = {
  minLength: 12,
  upper: /[A-Z]/,
  lower: /[a-z]/,
  digit: /\d/,
  symbol: /[^A-Za-z0-9]/,
}

export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_RULES.minLength) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_RULES.minLength} caractères.`
  }
  if (!PASSWORD_RULES.upper.test(password)) {
    return 'Ajoutez au moins une majuscule.'
  }
  if (!PASSWORD_RULES.lower.test(password)) {
    return 'Ajoutez au moins une minuscule.'
  }
  if (!PASSWORD_RULES.digit.test(password)) {
    return 'Ajoutez au moins un chiffre.'
  }
  if (!PASSWORD_RULES.symbol.test(password)) {
    return 'Ajoutez au moins un caractère spécial.'
  }
  return null
}

export function isStrongPassword(password: string): boolean {
  return passwordError(password) === null
}
