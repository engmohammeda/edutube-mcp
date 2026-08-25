import json, sys, glob, os

def has_ar(s): return any('؀' <= c <= 'ۿ' for c in (s or ''))

def validate(path, expect_no):
    d = json.load(open(path))
    probs = []
    m = d.get('metadata', {})
    if m.get('course_id') != 'phonetics': probs.append('course_id')
    if m.get('course_name_ar') != 'الصوتيات': probs.append('course_name_ar')
    if m.get('level') != 1: probs.append('level')
    if m.get('lesson_no') != expect_no: probs.append(f"lesson_no={m.get('lesson_no')}")
    if not m.get('title'): probs.append('title')
    lc = d.get('lesson_content', {})
    fs = lc.get('focus_sounds', [])
    mp = lc.get('minimal_pairs', [])
    ps = lc.get('practice_scripts', [])
    if not (fs or mp or ps): probs.append('lesson_content empty')
    for x in fs:
        if not x.get('symbol') or not has_ar(x.get('description')): probs.append('focus_sound bad'); break
    for x in mp:
        if not x.get('word1') or not x.get('word2'): probs.append('pair bad'); break
    for x in ps:
        if not x: probs.append('script bad'); break
    for x in d.get('global_vocabulary', []):
        if not (x.get('word') and x.get('meaning') and x.get('example_en') and x.get('example_ar')):
            probs.append('orphan vocab'); break
    for n in d.get('lesson_notes', []):
        if not has_ar(n): probs.append('note not Arabic'); break
    q = d.get('quiz', [])
    if len(q) != 10: probs.append(f'quiz={len(q)}')
    types = [t.get('type') for t in q]
    aq = types.count('audio_quiz'); tf = types.count('true_false')
    if aq < 5: probs.append(f'audio_quiz={aq}<5')
    if not (2 <= tf <= 4): probs.append(f'true_false={tf}')
    for t in q:
        if not t.get('explanation_ar'): probs.append('missing explanation_ar'); break
        if t.get('type') == 'audio_quiz':
            if not t.get('word_to_speak'): probs.append('audio_quiz no word_to_speak'); break
            if not isinstance(t.get('options'), list) or len(t['options']) != 4 or t['answer'] not in t['options']:
                probs.append('audio_quiz options'); break
    return probs

base = sys.argv[1] if len(sys.argv) > 1 else '/home/user/phonetics-output'
allok = True
files = sorted(glob.glob(os.path.join(base, 'lesson-*.json')))
for f in files:
    no = int(f.split('lesson-')[1].split('.json')[0])
    probs = validate(f, no)
    if probs: allok = False
    print(f"{os.path.basename(f)}: {'OK' if not probs else probs}")
print('RESULT:', 'ALL COMPLIANT' if allok and files else ('NONE FOUND' if not files else 'ISSUES'))
