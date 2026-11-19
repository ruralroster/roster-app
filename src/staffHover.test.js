import { staffHoverText } from './staffHover';

describe('staffHoverText', () => {
  const skills = [{ advanced_skill_id: 'a', name: 'Anaesthetics' }, { advanced_skill_id: 'o', name: 'Obstetrics' }];
  it('gives rank, FTE allocated and ASTs', () => {
    expect(staffHoverText({ name: 'Ann Example', rank: 'SMO', advanced_skills: ['a', 'o'] }, { hours: 44, target: 88 }, skills))
      .toBe('Ann Example · SMO · 50% of FTE allocated this pay fortnight (44 of 88 h) · AST: Anaesthetics, Obstetrics');
  });
  it('leaves out ASTs when there are none, and says casual for no FTE', () => {
    expect(staffHoverText({ name: 'Ben Sample', rank: 'RMO' }, { hours: 9, target: 0 }, skills))
      .toBe('Ben Sample · RMO · casual, no FTE (9 h this pay fortnight)');
  });
});
