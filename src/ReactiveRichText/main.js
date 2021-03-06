// @flow
import '@houshuang/react-quill/dist/quill.snow.css';

import React, { Component } from 'react';
import ReactQuill, { Quill } from '@houshuang/react-quill';
import { get, isEqual, last, forEach, isUndefined, filter, find } from 'lodash';
import uuid from 'cuid';
import QuillCursors from '@minervaproject/quill-cursors';

import {
  HighlightSearchText,
  highlightTargetRichText,
  cloneDeep
} from './frogutils';
import { LiViewTypes, formats } from './constants';
import LearningItemBlot from './LearningItemBlot';
import CustomQuillClipboard from './CustomQuillClipboard';
import CustomQuillToolbar from './CustomQuillToolbar';
import { pickColor } from './helpers';

// The below placeholder object is used to pass the parameters from the 'dataFn' prop
// from the main component to other ones. Generic definition to understand the structure
// and satisfy Flow's requirements
/* eslint-disable import/no-mutable-exports */
let reactiveRichTextDataFn = {
  getLearningTypesObj: () => {
    throw new Error('Should never be uninitialized');
  },
  LearningItem: () => {
    throw new Error('Should never be uninitialized');
  }
};

LearningItemBlot.blotName = 'learning-item';
LearningItemBlot.tagName = 'div';
LearningItemBlot.className = 'ql-learning-item';
Quill.register('formats/learning-item', LearningItemBlot);
Quill.register('modules/clipboard', CustomQuillClipboard, true);
Quill.register('modules/cursors', QuillCursors);

const debounce = (func, wait) => {
  var timeout;
  return function(...args) {
    var context = this;
    var later = function() {
      timeout = null;
      func.apply(context, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

const Delta = Quill.import('delta');
const Parchment = Quill.import('parchment');

const AuthorClass = new Parchment.Attributor.Class('author', 'ql-author', {
  scope: Parchment.Scope.INLINE
});
Parchment.register(AuthorClass);
Quill.register(AuthorClass, true);

const LiViewAttribute = new Parchment.Attributor.Attribute(
  'li-view',
  'li-view'
);
Parchment.register(LiViewAttribute);
Quill.register(LiViewAttribute, true);

const authorStyleElements = {};

type ReactivePropsT = {
  path?: string,
  rawData?: Object,
  dataFn: Object,
  data?: Object,
  readOnly?: boolean,
  shorten?: number,
  userId?: string,
  search?: string,
  onChange?: Function
};

class ReactiveRichText extends Component<
  ReactivePropsT,
  { path: ?((string | number)[]) }
> {
  quillRef: any;

  compositionStart: boolean;

  authorDeltaToApply: any;

  toolbarId: string = uuid();

  styleElements: {};

  state = {
    path: this.props.dataFn.getMergedPath(this.props.path)
  };

  constructor(props: ReactivePropsT) {
    super(props);
    reactiveRichTextDataFn = props.dataFn;
  }

  opListener = (op: Object[], source: string) => {
    if (source === this.quillRef) {
      // Ignore if the changes are from our own editor
      return;
    }
    if (this.quillRef) {
      const editor = this.quillRef.getEditor();
      if (!editor) {
        return;
      }

      if (this.props.shorten) {
        // getDocumentContent() returns the latest content of the document shortened
        editor.setContents(this.getDocumentContent());
      } else {
        forEach(op, operation => {
          const operations = get(operation, 'o.ops') || get(operation, 'o');
          forEach(operations, o => {
            const author = get(o, 'attributes.author');
            if (author) {
              this.addAuthor(author);
            }
          });
          const opPath = last(operation.p);
          // Ensures the ops are for exactly this editor in situations where there
          // are multiple active editors in the page
          if (opPath === this.props.path) {
            editor.updateContents(operation.o);
          }
        });
      }
    }
  };

  update = (props: ReactivePropsT) => {
    if (props.dataFn?.doc) {
      props.dataFn.doc.on('op', this.opListener);
    }
  };

  getDocumentContent = () => {
    let raw = cloneDeep(
      get(
        this.props.data
          ? { payload: this.props.data }
          : this.props.dataFn.doc.data,
        (this.state.path || []).join('.')
      )
    );

    if (this.props.readOnly) {
      const ops = cloneDeep(raw.ops);
      while (true) {
        const [tail] = ops.slice(-1);
        if (!tail) {
          break;
        }
        if (typeof tail.insert !== 'string') {
          break;
        }
        if (tail.insert.trim() !== '') {
          break;
        }
        ops.pop();
      }

      const [tail1] = ops.slice(-1);
      if (tail1) {
        if (typeof tail1.insert === 'string') {
          ops[ops.length - 1].insert = tail1.insert.trimEnd() + '\n';
        }
      }

      while (true) {
        const [hd] = ops.slice(0, 1);
        if (!hd) {
          break;
        }
        if (typeof hd.insert !== 'string') {
          break;
        }
        if (hd.insert.trim() !== '') {
          break;
        }
        ops.shift();
      }

      const [head1] = ops.slice(0, 1);
      if (head1) {
        if (typeof head1.insert === 'string') {
          ops[0].insert = head1.insert.trimStart();
        }
      }
      if (ops.length === 0) {
        ops[0] = { insert: '\n' };
      }
      raw.ops = ops;
    }

    if (this.props.search) {
      raw = highlightTargetRichText(raw, this.props.search);
    }

    return raw;
  };

  compositionStartHandler = () => {
    this.compositionStart = true;
    this.authorDeltaToApply = null;
  };

  compositionEndHandler = (editor: Object) => () => {
    this.compositionStart = false;
    if (this.authorDeltaToApply) {
      editor.updateContents(this.authorDeltaToApply, Quill.sources.SILENT);
      this.authorDeltaToApply = null;
    }
  };

  initializeAuthorship = () => {
    this.compositionStart = false;
    this.authorDeltaToApply = null;

    const editor = this.quillRef.getEditor();
    if (editor) {
      editor.scroll.domNode.addEventListener(
        'compositionstart',
        this.compositionStartHandler
      );
      editor.scroll.domNode.addEventListener(
        'compositionend',
        this.compositionEndHandler(editor)
      );
    }

    const userId = this.props.userId;
    if (userId) {
      this.addAuthor(userId);
    }
    const content = this.getDocumentContent();
    forEach(content.ops, op => {
      const author = get(op, 'attributes.author');
      if (author) {
        this.addAuthor(author);
      }
    });
  };

  turnAuthorshipOn = () => {
    const editor = this.quillRef.getEditor();
    if (editor && !editor.root.classList.contains('ql-authorship')) {
      editor.root.classList.add('ql-authorship');
    }
  };

  turnAuthorshipOff = () => {
    const editor = this.quillRef.getEditor();
    if (editor && editor.root.classList.contains('ql-authorship')) {
      editor.root.classList.remove('ql-authorship');
    }
  };

  toggleAuthorship = () => {
    const editor = this.quillRef.getEditor();
    if (editor) {
      editor.root.classList.toggle('ql-authorship');
    }
  };

  addAuthor(id: string) {
    if (!id) {
      return;
    }
    const color = this.props.getColor(id) || pickColor(id);
    const css = `.ql-authorship .ql-author-${id} { color: ${color}; }
    .ql-authorship div.ql-author-${id} {background-color: ${color}}`;

    if (!get(authorStyleElements, id)) {
      authorStyleElements[id] = document.createElement('style');
      authorStyleElements[id].type = 'text/css';
      authorStyleElements[id].classList.add('ql-authorship-style');
      authorStyleElements[id].classList.add(`ql-authorship-style-${id}`);
      authorStyleElements[id].innerHTML = css;
      document.documentElement // $FlowFixMe
        .getElementsByTagName('head')[0]
        .appendChild(authorStyleElements[id]);
    }
  }

  componentDidMount() {
    const editor = this.quillRef && this.quillRef.getEditor();
    if (!this.props.shorten) {
      if (editor) {
        // LI blots in existing content always trigger a change with source 'user'
        // on editor load. This causes the editor to duplicate the LIs in some
        // situations. So registering onChange handler with a delay to avoid
        // processing those initial deltas.
        setTimeout(() => {
          editor.on('text-change', this.handleChange);
          // In case the loaded document had LIs without correct spacing
          this.ensureSpaceAroundLis();

          editor.on('selection-change', this.handleSelectionChange);
        }, 100);

        // When any option is clicked from the quill toolbar from a list, the editor
        // view jumps to top. Following code fixes that.
        const toolbars = document.querySelectorAll('.ql-toolbar');
        toolbars.forEach(toolbar => {
          toolbar.addEventListener('mousedown', (event: *) => {
            event.preventDefault();
            event.stopPropagation();
          });
        });
      }

      if (!this.props.data && !this.props.rawData) {
        this.update(this.props);
        this.initializeAuthorship();
      }
    }
    const cursors = editor.getModule('cursors');

    const updateCursor = range =>
      this.props.dataFn.doc.submitPresence({
        p: this.state.path,
        t: 'rich-text',
        s: {
          u: this.props.userId,
          c: 0,
          s: [[range.index, range.index + range.length]]
        }
      });

    const debouncedUpdate = debounce(updateCursor, 500);

    editor.on('selection-change', (range, oldRange, source) => {
      if (range) {
        if (source === 'user') {
          updateCursor(range);
        } else {
          debouncedUpdate(range);
        }
      }
    });

    this.props.dataFn.doc.on('presence', (srcList, submitted) => {
      srcList.forEach(src => {
        if (!this.props.dataFn.doc.presence[src]?.p) return;

        const presence = this.props.dataFn.doc.presence[src];
        if (!isEqual(presence.p, this.state.path)) {
          cursors.removeCursor(presence.s.u);
          return;
        }

        if (presence.s.u) {
          var userid = presence.s.u;
          if (
            userid !== this.props.userId &&
            presence.s.s &&
            presence.s.s.length > 0
          ) {
            // TODO: Can QuillCursors support multiple selections?
            var sel = presence.s.s[0];

            // Use Math.abs because the sharedb presence type
            // supports reverse selections, but I don't think
            // Quill Cursors does.
            var len = Math.abs(sel[1] - sel[0]);
            var min = Math.min(sel[0], sel[1]);

            cursors.createCursor(userid, userid, this.props.getColor(userid));
            cursors.moveCursor(userid, { index: min, length: len });
            if (submitted) {
              cursors.flashCursor(userid);
            }
          }
        }
      });
    });
  }

  componentWillReceiveProps(nextProps: ReactivePropsT) {
    if (
      (nextProps.dataFn && nextProps.dataFn.doc.id) !==
        (this.props.dataFn && this.props.dataFn.doc.id) ||
      !isEqual(this.props.path, nextProps.path)
    ) {
      this.update(nextProps);
    }
  }

  shouldComponentUpdate(nextProps: Object) {
    return (
      this.props.shorten !== nextProps.shorten ||
      !!(this.props.readOnly || nextProps.readOnly) ||
      this.props.search !== nextProps.search
    );
  }

  componentWillUnmount() {
    if (!this.props.data && !this.props.rawData) {
      this.props.dataFn.doc.removeListener('op', this.opListener);
      if (!this.props.shorten) {
        const editor = this.quillRef.getEditor();
        if (editor) {
          editor.scroll.domNode.removeEventListener(
            'compositionstart',
            this.compositionStartHandler
          );
          editor.scroll.domNode.removeEventListener(
            'compositionend',
            this.compositionEndHandler(editor)
          );
        }
      }
    }
  }

  ensureSpaceAroundLis = () => {
    const editor = this.quillRef && this.quillRef.getEditor();
    if (editor) {
      const editorLength = editor.getLength();

      for (let i = 0; i < editorLength; i += 1) {
        const [blot] = editor.getLeaf(i);
        const blotName = get(blot, 'statics.blotName');

        if (blotName === 'learning-item') {
          const prevIndex = Math.max(i - 1, 0);
          const nextIndex = Math.min(i + 1, editor.getLength());
          const [prev] = editor.getLeaf(prevIndex);
          const [next] = editor.getLeaf(nextIndex);
          // The insertText triggers handleChange() and that in turn calls back
          // ensureSpaceAroundLis() until spaces are ensured around all
          // LIs in the document
          if (i === 0 || get(prev, 'statics.blotName') === 'learning-item') {
            editor.insertText(i, '\n', Quill.sources.USER);
            return;
          } else if (get(next, 'statics.blotName') === 'learning-item') {
            editor.insertText(nextIndex, '\n', Quill.sources.USER);
            return;
          } else if (i === editorLength - 1) {
            editor.insertText(i + 1, '\n', Quill.sources.USER);
          }
        }
      }
    }
  };

  handleChange = (delta: Object, oldContents: Object, source: string) => {
    if (!this.props.readOnly) {
      if (source !== 'user') {
        return;
      }
      this.submitOperation(delta);
      this.ensureSpaceAroundLis();

      // Quill does not automatically scroll the editor for newlines at the
      // end of the doc. So doing it manually.
      const editor = this.quillRef.getEditor();
      if (editor) {
        const newlineInsertFound = find(
          delta.ops,
          op => get(op, 'insert') === '\n'
        );
        const index = get(editor.getSelection(), 'index');
        if (
          !isUndefined(index) &&
          newlineInsertFound &&
          index + 2 >= editor.getLength()
        ) {
          this.scrollToBottom();
        }
      }
    }
  };

  handleSelectionChange = (
    range: Object,
    previousRange: Object,
    source: string,
    trigger: string
  ) => {
    // This handler gets triggered for all selection changes. We only want to
    // process the event emitted by li copy button.
    if (trigger === 'li-copy') {
      const editor = this.quillRef.getEditor();
      if (editor && range) {
        editor.setSelection(range, Quill.sources.SILENT);
      }
    }
  };

  submitOperation = (delta: {
    ops: Array<{
      delete: number,
      insert: Object | string,
      retain: number,
      attributes: { author?: string, 'li-view'?: string }
    }>
  }) => {
    if (!this.props.readOnly && this.props.dataFn && !this.props.onChange) {
      const editor = this.quillRef.getEditor();

      if (editor) {
        const authorDelta = new Delta();
        const authorFormat = { author: this.props.userId };

        delta.ops.forEach(op => {
          if (op.delete) {
            return;
          }

          // Add authorship to only inserts
          if (op.insert) {
            op.attributes = op.attributes || {};

            if (
              op.attributes.author &&
              op.attributes.author === this.props.userId
            ) {
              return;
            }

            op.attributes.author = this.props.userId;

            authorDelta.retain(
              op.retain || op.insert.length || 1,
              authorFormat
            );
          } else {
            const liView = get(op, 'attributes.li-view');
            if (liView) {
              authorDelta.retain(op.retain, op.attributes);
            } else {
              authorDelta.retain(op.retain);
            }
          }
        });

        // if IME keyboard (e.g. CH Pinyin), only update the delta with author attribute
        // on `compositionend`. If non-IME keyboard (e.g. English) there will be no `compositionStart`
        this.authorDeltaToApply = authorDelta; // copy it to apply later at `conpositionend` for IME keyboards
        if (!this.compositionStart) {
          // if non-IME keyboards, else wait for the `compositionend` to fire (see above)
          editor.updateContents(authorDelta, Quill.sources.SILENT);
        }
      }

      const op = {
        p: this.state.path,
        t: 'rich-text',
        o: delta.ops
      };

      this.props.dataFn.doc.submitOp([op], { source: this.quillRef });
    }
  };

  onDrop = (e: { item: Object | string }, initialView?: string) => {
    const editor = this.quillRef.getEditor();
    const item = e?.item;

    if (editor && item) {
      // getSelection() method of ReactQuill API returns null since the editor
      // is not focused during drop.
      const index = get(editor, 'selection.savedRange.index');
      const insertPosition = isUndefined(index)
        ? editor.getLength() - 1
        : index;

      const params = {
        liId: JSON.stringify(item),
        authorId: this.props.userId,
        view: initialView
      };

      editor.insertEmbed(
        insertPosition,
        'learning-item',
        params,
        Quill.sources.USER
      );

      editor.setSelection(insertPosition + 1, 0, Quill.sources.USER);

      // If LI inserted at end of document, manually scroll to bottom.
      // +3 >= is due to the newline we might add before the LI to ensure spacing
      if (insertPosition + 3 >= editor.getLength()) {
        this.scrollToBottom();
      }
    }
  };

  scrollToBottom = () => {
    const scrollElement = get(this.quillRef, 'editingArea.firstChild');
    if (scrollElement) {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
  };

  insertNewLi = (type: string) => {
    if (type) {
      const newLiId = this.props.dataFn.createLearningItem(type);
      this.onDrop({ item: newLiId }, LiViewTypes.EDIT);
    }
  };

  getLiTypeList = () => {
    const allLiTypes = this.props.dataFn.getLearningTypesObj();
    return filter(
      allLiTypes,
      type =>
        get(type, 'dataStructure') &&
        get(type, 'Editor') &&
        get(type, 'id') !== 'li-richText' &&
        get(type, 'id') !== 'li-doubleRichText'
    );
  };

  render() {
    if (this.props.shorten) {
      const raw = get(
        this.props.data
          ? { payload: this.props.data }
          : this.props.dataFn.doc.data,
        (this.state.path || []).join('.')
      );
      if (raw) {
        const contents = raw.ops.reduce((text, op) => {
          if (typeof op.insert !== 'string') return text + ' ';
          return text + op.insert;
        }, '');

        return (
          <HighlightSearchText
            haystack={contents}
            needle={this.props.search}
            shorten
          />
        );
      } else {
        return null;
      }
    }

    const defaultValue = this.getDocumentContent();
    const props = this.props;
    const scrollContainerClass = 'scroll-container';
    const editorStyle = props.readOnly
      ? { borderStyle: 'hidden' }
      : {
          overflowY: 'auto',
          height: '100%'
        };
    return (
      <div
        style={{ height: '100%' }}
        onMouseOver={() => {
          if (this.props.dataFn.listore.dragState) {
            this.props.dataFn.listore.setOverCB(this.onDrop);
          }
        }}
        onMouseLeave={() => {
          if (this.props.dataFn.listore?.setOverCB) {
            this.props.dataFn.listore.setOverCB(null);
          }
        }}
      >
        {!get(props, 'readOnly') && (
          <CustomQuillToolbar
            id={this.toolbarId}
            readOnly={get(props, 'readOnly')}
            liTypes={this.getLiTypeList()}
          />
        )}
        <ReactQuill
          defaultValue={this.props.rawData || defaultValue}
          ref={element => {
            this.quillRef = element;
          }}
          readOnly={get(props, 'readOnly')}
          formats={formats}
          style={{ height: '90%' }}
          modules={{
            cursors: true,
            toolbar: get(props, 'readOnly')
              ? null
              : {
                  container: `#toolbar-${this.toolbarId}`,
                  handlers: {
                    toggleAuthorship: this.toggleAuthorship,
                    insertLi: this.insertNewLi
                  }
                }
          }}
          scrollingContainer={`.${scrollContainerClass}`}
          onChange={this.props.onChange}
        >
          <div className={scrollContainerClass} style={editorStyle} />
        </ReactQuill>
      </div>
    );
  }
}
window.q = Quill;
export { reactiveRichTextDataFn };
export default ReactiveRichText;
