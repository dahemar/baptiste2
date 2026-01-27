#!/usr/bin/env python3
import os,sys,subprocess,base64,json
from urllib.parse import quote

ROOT='.'
REPO='dahemar/baptiste2'

def gh_get(path):
    cmd=['gh','api',f'/repos/{REPO}/contents/{path}']
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired as e:
        print(f"[ERROR] gh api GET timeout for {path}")
        return subprocess.CompletedProcess(cmd, returncode=2, stdout='', stderr='timeout')

def get_token():
    try:
        p=subprocess.run(['gh','auth','token'], capture_output=True, text=True, timeout=10)
    except subprocess.TimeoutExpired:
        print('Could not get gh token: timeout', file=sys.stderr)
        sys.exit(2)
    if p.returncode!=0:
        print('Could not get gh token', file=sys.stderr)
        sys.exit(2)
    return p.stdout.strip()

TOKEN=get_token()
HEADERS=['-H','Accept: application/vnd.github+json','-H',f'Authorization: token {TOKEN}']

success=0
errors=0
for dirpath,dirnames,filenames in os.walk(ROOT):
    if '.git' in dirpath.split(os.sep):
        continue
    for fname in filenames:
        fp=os.path.join(dirpath,fname)
        rel=os.path.relpath(fp,ROOT)
        # skip unwanted directories/artifacts
        if rel.startswith('astro-app/.git-submodule-backup'):
            continue
        if rel.startswith('.video_push_logs'):
            continue
        if rel.startswith('astro-app/.astro'):
            continue
        if rel.endswith('.DS_Store'):
            continue
        api_path=quote(rel)
        # get remote sha if exists
        p=gh_get(api_path)
        sha=None
        if p.returncode==0:
            try:
                obj=json.loads(p.stdout)
                sha=obj.get('sha')
            except Exception:
                sha=None
        # read and b64
        try:
            with open(fp,'rb') as f:
                b=f.read()
        except Exception as e:
            print('[ERROR] read',rel,e)
            errors+=1
            continue
        content_b64=base64.b64encode(b).decode()
        payload={'message':f'chore: add {rel} via API','content':content_b64}
        if sha:
            payload['sha']=sha
        tmp='/tmp/payload.json'
        with open(tmp,'w') as t:
            json.dump(payload,t)
        url=f'https://api.github.com/repos/{REPO}/contents/{rel}'
        curl_cmd=['curl','-s','-X','PUT']+HEADERS+['-d',f'@{tmp}',url]
        try:
            q=subprocess.run(curl_cmd, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            print('[FAIL]',rel,'curl timeout')
            errors+=1
            continue
        if q.returncode==0:
            try:
                resp=json.loads(q.stdout)
                if 'content' in resp:
                    print('[OK]',rel)
                    success+=1
                else:
                    print('[FAIL]',rel, q.stdout.strip())
                    errors+=1
            except Exception:
                print('[FAIL]',rel,'invalid response')
                errors+=1
        else:
            print('[FAIL]',rel,q.stderr.strip())
            errors+=1

print('Done. success=',success,'errors=',errors)
if errors>0:
    sys.exit(2)
else:
    sys.exit(0)
