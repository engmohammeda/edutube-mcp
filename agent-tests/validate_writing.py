import json, sys, glob, os

def has_ar(s): return any('؀' <= c <= 'ۿ' for c in (s or ''))

def validate(path, expect_no):
    d = json.load(open(path))
    probs = []
    m = d.get('metadata', {})
    if m.get('course_id') != 'writing': probs.append('course_id')
    if m.get('course_name_ar') != 'الكتابة': probs.append('course_name_ar')
    if m.get('level') != 1: probs.append('level')
    if m.get('lesson_no') != expect_no: probs.append(f"lesson_no={m.get('lesson_no')}")
    if not m.get('title'): probs.append('title')
    lc = d.get('lesson_content', {})
    if not lc.get('topic_en'): probs.append('topic_en')
    if not has_ar(lc.get('topic_ar')): probs.append('topic_ar')
    bq = lc.get('brainstorming_questions', [])
    if not bq: probs.append('brainstorming empty')
    for x in bq:
        if not x.get('question_en') or not x.get('suggested_answer_en'): probs.append('bq fields'); break
    gs = lc.get('guided_sentences', [])
    if not gs: probs.append('guided empty')
    for x in gs:
        if not x.get('en') or not has_ar(x.get('ar')): probs.append('gs fields'); break
    fd = lc.get('final_draft') or {}
    if not fd.get('en') or not has_ar(fd.get('ar')): probs.append('final_draft')
    for x in d.get('global_vocabulary', []):
        if not (x.get('word') and x.get('meaning') and x.get('example_en') and x.get('example_ar')):
            probs.append('orphan vocab'); break
    for n in d.get('lesson_notes', []):
        if not has_ar(n): probs.append('note not Arabic'); break
    q = d.get('quiz', [])
    if len(q) != 10: probs.append(f'quiz={len(q)}')
    types = [t.get('type') for t in q]
    if 'written' not in types: probs.append('no written')
    if 'multiple_choice' not in types or 'true_false' not in types: probs.append('missing mix')
    for t in q:
        if not t.get('explanation_ar'): probs.append('missing explanation_ar'); break
        if t.get('type') == 'multiple_choice' and (not isinstance(t.get('options'), list) or len(t['options']) != 4 or t['answer'] not in t['options']):
            probs.append('mc options'); break
        if t.get('type') == 'written' and t.get('options') is not None: probs.append('written options'); break
    return probs

base = sys.argv[1] if len(sys.argv) > 1 else '/home/user/writing-output'
allok = True
files = sorted(glob.glob(os.path.join(base, 'lesson-*.json')))
for f in files:
    no = int(f.split('lesson-')[1].split('.json')[0])
    probs = validate(f, no)
    if probs: allok = False
    print(f"{os.path.basename(f)}: {'OK' if not probs else probs}")
print('RESULT:', 'ALL COMPLIANT' if allok and files else ('NONE FOUND' if not files else 'ISSUES'))
