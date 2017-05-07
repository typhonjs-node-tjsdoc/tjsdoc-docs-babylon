import * as Docs           from './doc/';

import DocGenerator        from './generator/DocGenerator.js';

// TODO: uncommment the line below to use the old 1-pass algorithm and comment out the line above.
// import DocGenerator        from './generator/DocGeneratorOld.js';

import TestDocGenerator    from './generator/TestDocGenerator.js';


import ASTUtil             from './parser/ASTUtil.js';
import CommentParser       from './parser/CommentParser.js';
import ParamParser         from './parser/ParamParser.js';

export { Docs, DocGenerator, TestDocGenerator };

/**
 * Wires up two events to retrieve the Babylon docs on the plugin eventbus.
 *
 * 'tjsdoc:data:docs:all:get': Returns all Babylon docs.
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
      { name: 'tjsdoc-doc-generator', instance: DocGenerator },
      { name: 'tjsdoc-doc-generator-test', instance: TestDocGenerator },
      { name: 'tjsdoc-param-parser', instance: new ParamParser() }
   ]);

   // Add event binding to retrieve all Babylon and common doc object generator classes.
   eventbus.on('tjsdoc:data:docs:all:get', () => Docs);

   // Add event binding to get DocGenerator.
   eventbus.on('tjsdoc:system:doc:generator:get', () => DocGenerator);

   // Add event binding to get TestDocGenerator.
   eventbus.on('tjsdoc:system:doc:generator:test:get', () => TestDocGenerator);
}

