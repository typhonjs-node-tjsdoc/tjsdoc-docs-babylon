import * as Docs           from './doc/';

import * as DocFactory     from './factory/DocFactory.js';
import * as TestDocFactory from './factory/TestDocFactory.js';

import CommentParser       from './parser/CommentParser.js';
import ParamParser         from './parser/ParamParser.js';

export { Docs, DocFactory, TestDocFactory };

/**
 * Wires up two events to retrieve the Babylon docs on the plugin eventbus.
 *
 * 'tjsdoc:get:all:docs': Returns all Babylon docs.
 *
 * 'tjsdoc:get:doc': Returns a single Babylon doc by name.
 *
 * @param {PluginEvent} ev - The plugin event.
 *
 * @ignore
 */
export function onPluginLoad(ev)
{
   const eventbus = ev.eventbus;

   // Instances are being loaded into the plugin manager so auto log filtering needs an explicit filter.
   eventbus.trigger('log:filter:add', {
      type: 'inclusive',
      name: 'tjsdoc-docs-babylon',
      filterString: '(tjsdoc-docs-babylon\/dist|tjsdoc-docs-babylon\/src)'
   });

   // Adds all Babylon doc parser plugins
   eventbus.trigger('plugins:add:all', [
      { name: 'tjsdoc-comment-parser', instance: new CommentParser() },
      { name: 'tjsdoc-doc-factory', instance: DocFactory },
      { name: 'tjsdoc-param-parser', instance: new ParamParser() },
      { name: 'tjsdoc-test-doc-factory', instance: TestDocFactory }
   ]);
}

