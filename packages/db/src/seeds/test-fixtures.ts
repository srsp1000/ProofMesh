export const TEST_FIXTURES = {
  tenantAlpha: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Tenant Alpha Corp',
    slug: 'tenant-alpha'
  },
  tenantBeta: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Tenant Beta Ltd',
    slug: 'tenant-beta'
  },
  projectAlpha: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    key: 'KYC-BOT',
    name: 'KYC Compliance Bot'
  },
  principalAlpha: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    type: 'service_account',
    identifier: 'kyc-agent@tenant-alpha.com',
    displayName: 'KYC Agent Alpha'
  },
  claimConcept: {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    key: 'applicant-credit-risk'
  },
  claimVersion: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    statement: 'Debt-to-income ratio is 28%, meeting underwriting guidelines.',
    status: 'submitted' as const
  }
};
