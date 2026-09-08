// The numbers from issue 13 and the one plain sentence a bookkeeper sees when
// each one is hit. Both apps import this file so the number enforced and the
// number in the message can never drift apart.
export const LIMITS = {
  requestsPerIpPerMinute: 60,
  workspacesPerIpPerHour: 3,
  uploadsPerWorkspacePerDay: 10,
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxPagesPerDocument: 20,
  wrongCodeAttemptsBeforeLockout: 5,
  lockoutMinutes: 15,
  workspaceUntouchedDays: 14,
  monthlyModelSpendUsd: 15,
} as const;

export const MESSAGES = {
  doorWrongCode: 'That code is not right.',
  doorLocked: `Too many wrong codes. Wait ${LIMITS.lockoutMinutes} minutes and try again.`,
  doorRequired: 'Enter the access code to continue.',
  tooManyRequests: 'Too many requests. Wait a minute and try again.',
  tooManyWorkspaces: 'Too many new workspaces from this address. Wait an hour and try again.',
  tooManyUploadsToday: `This workspace has used its ${LIMITS.uploadsPerWorkspacePerDay} uploads for today. The sample documents still work.`,
  fileTooLarge: 'This file is over the 10 MB limit.',
  tooManyPages: `This file has more than ${LIMITS.maxPagesPerDocument} pages.`,
  spendCapReached:
    'Holocron is at its monthly processing budget. You can still review every document already here.',
} as const;
