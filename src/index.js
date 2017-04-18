import * as Docs           from './doc/';

import DocGenerator        from './generator/DocGenerator.js';
import TestDocGenerator    from './generator/TestDocGenerator.js';

// TODO: remove once the old 1-pass algorithm is removed.
// import DocGeneratorOld     from './generator/DocGeneratorOld.js';

import ASTUtil             from './parser/ASTUtil.js';
import CommentParser       from './parser/CommentParser.js';
import ParamParser         from './parser/ParamParser.js';

export { Docs, DocGenerator, TestDocGenerator };

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
      { name: 'tjsdoc-ast-util', instance: new ASTUtil() },
      { name: 'tjsdoc-comment-parser', instance: new CommentParser() },

      // TODO to enabled to 1-pass algorithm comment out DocGenerator and uncomment DocGeneratorOld
      { name: 'tjsdoc-doc-generator', instance: DocGenerator },
      // { name: 'tjsdoc-doc-generator', instance: DocGeneratorOld },

      { name: 'tjsdoc-param-parser', instance: new ParamParser() },
      { name: 'tjsdoc-test-doc-generator', instance: TestDocGenerator }
   ]);

   // Add event binding to retrieve all Babylon and common doc object generator classes.
   eventbus.on('tjsdoc:data:docs:all:get', () => Docs);
}

