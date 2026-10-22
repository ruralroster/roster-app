import fs from 'fs';
import path from 'path';
import { isEligibleForOffer, canCoverSenior, offerGradeForRank } from './offerEligibility';

const SMO = { rank: 'Consultant', requires_supervision: false };
const REG = { rank: 'Registrar', requires_supervision: true };
const AT = { rank: 'Advanced Trainee', requires_supervision: true, can_cover_senior: true };
const INTERN = { rank: 'Intern', requires_supervision: true };

const base = {
  offerRole: 'registrar',
  rankRow: REG,
  requiredGrade: null,
  roleFilled: false,
  isAvailable: true,
  activityName: 'Emergency',
  restrictions: [],
  requiredSkills: [],
  skills: [],
};

test('the Edge Function copy matches this file exactly', () => {
  const here = fs.readFileSync(path.join(__dirname, 'offerEligibility.js'), 'utf8');
  const shared = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'offerEligibility.js'), 'utf8');
  expect(shared).toBe(here);
});

describe('who can cover senior shifts', () => {
  test('seniors and advanced trainees can, other supervised ranks cannot', () => {
    expect(canCoverSenior(SMO)).toBe(true);
    expect(canCoverSenior(AT)).toBe(true);
    expect(canCoverSenior(REG)).toBe(false);
    expect(canCoverSenior(null)).toBe(false);
    expect(offerGradeForRank(AT)).toBe('smo');
    expect(offerGradeForRank(INTERN)).toBe('intern');
  });
});

describe('isEligibleForOffer', () => {
  test('anyone configured can take an ED registrar shift', () => {
    expect(isEligibleForOffer(base)).toBe(true);
    expect(isEligibleForOffer({ ...base, rankRow: SMO })).toBe(true);
    expect(isEligibleForOffer({ ...base, rankRow: INTERN })).toBe(true);
  });

  test('an unconfigured rank is never eligible', () => {
    expect(isEligibleForOffer({ ...base, rankRow: null })).toBe(false);
  });

  test('juniors cannot take senior shifts, advanced trainees can', () => {
    const consultantOffer = { ...base, offerRole: 'consultant' };
    expect(isEligibleForOffer({ ...consultantOffer, rankRow: REG })).toBe(false);
    expect(isEligibleForOffer({ ...consultantOffer, rankRow: AT })).toBe(true);
    expect(isEligibleForOffer({ ...consultantOffer, rankRow: SMO })).toBe(true);

    const smoCard = { ...base, requiredGrade: 'smo' };
    expect(isEligibleForOffer({ ...smoCard, rankRow: REG })).toBe(false);
    expect(isEligibleForOffer({ ...smoCard, rankRow: AT })).toBe(true);
  });

  test('a registrar-graded card is closed to interns', () => {
    expect(isEligibleForOffer({ ...base, requiredGrade: 'registrar', rankRow: INTERN })).toBe(false);
  });

  test('specialty: an anaesthetics shift needs the Anaesthetics skill', () => {
    const anaesthetics = { ...base, rankRow: SMO, activityName: 'Anaesthetics', requiredSkills: ['anaes'] };
    expect(isEligibleForOffer({ ...anaesthetics, skills: ['obs'] })).toBe(false);
    expect(isEligibleForOffer({ ...anaesthetics, skills: ['anaes'] })).toBe(true);
  });

  test('must be marked available, not restricted, and the slot still empty', () => {
    expect(isEligibleForOffer({ ...base, isAvailable: false })).toBe(false);
    expect(isEligibleForOffer({ ...base, restrictions: ['Emergency'] })).toBe(false);
    expect(isEligibleForOffer({ ...base, roleFilled: true })).toBe(false);
  });
});
