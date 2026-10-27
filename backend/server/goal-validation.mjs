export function goalValidationMessage(goal) {
  const placeholders = [...new Set((goal.match(/\[(?:specific tasks|tasks|hours|skills|role|your [^\]\n]+)\]/gi) || []))];
  return placeholders.length ? `Replace ${placeholders.join(', ')} with your actual details before starting. These placeholders would otherwise appear in your hiring post.` : '';
}
