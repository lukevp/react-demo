import * as React from 'react';
import { connection } from './connection';
import { useReactive } from '@chilifrog/reactive-tools';
import ReactiveRichText from './ReactiveRichText/main';
import { generateUID, uidColor } from './getUser';
import { Presence } from './Presence'

const uid = generateUID();

export const Display = () => {
  const [data, dataFn, timeout] = useReactive(
    connection,
    'examples',
    'stian5',
    uid
  );
  if (timeout) {
    return <h1>Timeout</h1>;
  }
  if (!data) {
    return '...';
  }
  return (
    <div>
      <h1>Demo of Quill with cursors</h1>
      <div style={{ backgroundColor: uidColor(uid) }}>{uid}</div>
      <ReactiveRichText
        dataFn={dataFn}
        path="text"
        userId={uid}
        getColor={uidColor}
      />
      <hr />
      <ReactiveRichText
        dataFn={dataFn}
        path="text2"
        userId={uid}
        getColor={uidColor}
      />
      <hr />
      <Presence dataFn={dataFn} id="stian5" />
    </div>
  );
};
