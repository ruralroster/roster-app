import { formatHours } from './fteFortnight';

// The hover text on a name in the Planner and Day view: rank, how much of
// their FTE is allocated in that day's pay fortnight, and their advanced
// skills (ASTs). load: fortnightLoad's { hours, target }; advancedSkills:
// the department's list, to name staff.advanced_skills' ids.
export function staffHoverText(staff, load, advancedSkills = []) {
  if (!staff) return '';
  const parts = [staff.name, staff.rank || 'no rank'];
  if (load) {
    parts.push(load.target > 0
      ? `${Math.round((load.hours / load.target) * 100)}% of FTE allocated this pay fortnight (${formatHours(load.hours)} of ${formatHours(load.target)} h)`
      : `casual, no FTE (${formatHours(load.hours)} h this pay fortnight)`);
  }
  const skills = (staff.advanced_skills || [])
    .map(id => advancedSkills.find(sk => sk.advanced_skill_id === id)?.name)
    .filter(Boolean);
  if (skills.length) parts.push(`AST: ${skills.join(', ')}`);
  return parts.join(' · ');
}
