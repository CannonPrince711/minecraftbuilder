import json,re
def norm(s):
    m=re.match(r'^([^\[]+)(?:\[(.*)\])?$',s)
    name,props=m.group(1),m.group(2)
    if not props: return name
    kv=sorted(props.split(','))
    return name+'['+','.join(kv)+']'
leg=json.load(open('data/legacy.json'))
blocks={k:norm(v) for k,v in leg['blocks'].items()}
json.dump(blocks,open('src/data/legacy-blocks.json','w'),separators=(',',':'))
ids={}
for f in ['data/blocks112.json','data/items112.json']:
    for b in json.load(open(f)): ids.setdefault('minecraft:'+b['name'],b['id'])
items={}
for k,v in leg['items'].items():
    items[k]=v
bid={b['id']:'minecraft:'+b['name'] for b in json.load(open('data/blocks112.json'))}
json.dump({'nameToId':ids,'items':items,'blockIdToName':bid},open('src/data/legacy-items.json','w'),separators=(',',':'))
print(len(blocks),len(ids),len(items))
