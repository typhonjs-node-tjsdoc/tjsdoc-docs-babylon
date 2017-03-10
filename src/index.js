import * as Docs        from './doc/';

import DocFactory       from './factory/DocFactory.js';
import TestDocFactory   from './factory/TestDocFactory.js';

import CommentParser    from './parser/CommentParser.js';
import ParamParser      from './parser/ParamParser.js';

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
      { name: 'tjsdoc-param-parser', instance: new ParamParser() }
   ]);

   // Add doc factory event bindings --------------------------------------------------------------------------------

   eventbus.on('tjsdoc:create:code:doc:factory', (ast, code, dirPath, filePath) =>
   {
      if (typeof ast !== 'object')
      {
         throw new TypeError(`'tjsdoc:create:code:doc:factory' - 'ast' is not an 'object'.`);
      }

      if (typeof code !== 'string')
      {
         throw new TypeError(`'tjsdoc:create:code:doc:factory' - 'code' is not a 'string'.`);
      }

      if (typeof dirPath !== 'string')
      {
         throw new TypeError(`'tjsdoc:create:code:doc:factory' - 'dirPath' is not a 'string'.`);
      }

      const pathResolver = eventbus.triggerSync('tjsdoc:create:path:resolver', dirPath, filePath);

      if (typeof pathResolver !== 'object')
      {
         throw new TypeError(`'tjsdoc:create:code:doc:factory' - Could not create 'pathResolver'.`);
      }

      return new DocFactory(ast, pathResolver, eventbus, code);
   });

   eventbus.on('tjsdoc:create:file:doc:factory', (ast, dirPath, filePath, packageName, mainFilePath) =>
   {
      if (typeof ast !== 'object')
      {
         throw new TypeError(`'tjsdoc:create:file:doc:factory' - 'ast' is not an 'object'.`);
      }

      if (typeof dirPath !== 'string')
      {
         throw new TypeError(`'tjsdoc:create:file:doc:factory' - 'dirPath' is not a 'string'.`);
      }

      if (typeof filePath !== 'string')
      {
         throw new TypeError(`'tjsdoc:create:file:doc:factory' - 'filePath' is not a 'string'.`);
      }

      const pathResolver = eventbus.triggerSync('tjsdoc:create:path:resolver', dirPath, filePath, packageName,
       mainFilePath);

      if (typeof pathResolver !== 'object')
      {
         throw new TypeError(`'tjsdoc:create:file:doc:factory' - Could not create 'pathResolver'.`);
      }

      return new DocFactory(ast, pathResolver, eventbus);
   });

   eventbus.on('tjsdoc:create:test:doc:factory', (type, ast, dirPath, filePath) =>
   {
      if (typeof type !== 'string')
      {
         throw new TypeError(`'tjsdoc:create:test:doc:factory' - 'type' is not a 'string'.`);
      }

      if (typeof ast !== 'object')
      {
         throw new TypeError(`'tjsdoc:create:test:doc:factory' - 'ast' is not an 'object'.`);
      }

      if (typeof dirPath !== 'string')
      {
         throw new TypeError(`'tjsdoc:create:test:doc:factory' - 'dirPath' is not a 'string'.`);
      }

      if (typeof filePath !== 'string')
      {
         throw new TypeError(`'tjsdoc:create:test:doc:factory' - 'filePath' is not a 'string'.`);
      }

      const pathResolver = eventbus.triggerSync('tjsdoc:create:path:resolver', dirPath, filePath);

      if (typeof pathResolver !== 'object')
      {
         throw new TypeError(`'tjsdoc:create:test:doc:factory' - Could not create 'pathResolver'.`);
      }

      return new TestDocFactory(type, ast, pathResolver, eventbus);
   });

   eventbus.on('tjsdoc:get:all:docs', () => { return Docs; });

   eventbus.on('tjsdoc:get:doc', (name) =>
   {
      if (typeof name !== 'string') { throw new TypeError(`'tjsdoc:get:doc' - 'name' is not a 'string'.`); }

      if (typeof Docs[name] !== 'undefined')
      {
         throw new ReferenceError(`'tjsdoc:get:doc' - Doc not found for 'name':  '${name}'.`);
      }

      return Docs[name];
   });
}
