import * as Docs  from '../doc/';

/**
 * Provides a symbol to store checking if already covered.
 * @type {Symbol}
 * @ignore
 */
const s_ALREADY = Symbol('already');

/**
 * Test doc generator. Provides static doc object generation for test files inserting into the given DocDB.
 *
 * @example
 * TestDocGenerator.resetAndTraverse(ast, docDB, pathResolver, eventbus);
 */
export default class TestDocGenerator
{
   /**
    * Test type. For now only `mocha` is supported.
    * @type {string}
    */
   static _type = void 0;

   /**
    * Wires up the event binding to get TestDocGenerator.
    *
    * @param {PluginEvent} ev - The plugin event.
    */
   static onPluginLoad(ev)
   {
      ev.eventbus.on('tjsdoc:system:doc:generator:test:get', () => TestDocGenerator);
   }

   /**
    * Sets any test type from the target project TJSDocConfig instance. By setting the test type in `onPreGenerate`
    * it is possible to provide the same method signature for `resetAndTraverse` as `DocGenerator`.
    *
    * @param {PluginEvent} ev - The plugin event.
    */
   static onPreGenerate(ev)
   {
      if (ev.data.config.test) { this._type = ev.data.config.test.type; }
   }

   /**
    * Resets TestDocGenerator and traverses code for doc object / docDB insertion.
    *
    * @param {AST}            ast - AST of test code.
    *
    * @param {DocDB}          docDB - The target DocDB.
    *
    * @param {PathResolver}   pathResolver - Path resolver associated with test code.
    *
    * @param {EventProxy}     eventbus - An event proxy for the main eventbus.
    *
    * @param {string}         handleError - Determines how to handle errors. Options are `log` and `throw` with the
    *                                       default being to throw any errors encountered.
    */
   static resetAndTraverse(ast, docDB, pathResolver, eventbus, handleError)
   {
      if (typeof ast !== 'object') { throw new TypeError(`'ast' is not an 'object'.`); }

      /**
       * AST of test code.
       * @type {AST}
       */
      this._ast = ast;

      /**
       * The target DocDB.
       * @type {DocDB}
       * @private
       */
      this._docDB = docDB;

      /**
       * Path resolver associated with test code.
       * @type {PathResolver}
       */
      this._pathResolver = pathResolver;

      /**
       * Stores the plugin eventbus proxy.
       * @type {EventProxy}
       */
      this._eventbus = eventbus;

      /**
       * Determines how to handle errors. Options are `log` and `throw` with the default being to throw any errors
       * encountered.
       * @type {string}
       * @private
       */
      this._handleError = handleError;

      // Gets the current global / main plugin DocDB counter doc ID then increment it.
      const docID = eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get');

      /**
       * The associated ES file / module ID.
       * @type {number}
       */
      this._moduleID = docID;

      // Test file doc
      const staticDoc = Docs.ModuleTestFileDoc.create(docID, ast, ast, pathResolver, [], this._eventbus);

      // Insert test file doc and reset.
      this._docDB.insertStaticDoc(staticDoc);

      this._traverse();
   }

   /**
    * Returns the current AST set.
    *
    * @returns {AST}
    */
   static get ast()
   {
      return this._ast;
   }

   /**
    * Returns the current file path set.
    *
    * @returns {string|undefined}
    */
   static get filePath()
   {
      return this._pathResolver ? this._pathResolver.filePath : void 0;
   }

   /**
    * Gets a unique id.
    *
    * @returns {number} unique id.
    * @private
    */
   static _getUniqueId()
   {
      if (!this._sequence) { /** @type {number} */ this._sequence = 0; }

      return this._sequence++;
   }

   /**
    * Push a node for generator processing.
    *
    * @param {ASTNode} node - target node.
    * @param {ASTNode} parentNode - parent node of target node.
    */
   static push(node, parentNode)
   {
      if (node[s_ALREADY]) { return; }

      node[s_ALREADY] = true;

      Reflect.defineProperty(node, 'parent', { value: parentNode });

      // In the future other testing frameworks may be supported, but only Mocha is presently.
      this._pushForMocha(node, parentNode);
   }

   /**
    * push node as mocha test code.
    * @param {ASTNode} node - target node.
    * @private
    */
   static _pushForMocha(node)
   {
      if (node.type !== 'ExpressionStatement') { return; }

      const expression = node.expression;

      if (expression.type !== 'CallExpression') { return; }

      switch (expression.callee.name)
      {
         case 'describe':
         case 'it':
         case 'context':
         case 'suite':
         case 'test':
            break;

         default:
            return;
      }

      expression[s_ALREADY] = true;

      Reflect.defineProperty(expression, 'parent', { value: node });

      let tags = [];

      if (node.leadingComments && node.leadingComments.length)
      {
         const comment = node.leadingComments[node.leadingComments.length - 1];

         tags = this._eventbus.triggerSync('tjsdoc:system:parser:comment:parse', comment);
      }

      const uniqueId = this._getUniqueId();

      expression._tjsdocTestId = uniqueId;
      expression._tjsdocTestName = expression.callee.name + uniqueId;

      const staticDoc = Docs.TestDoc.create(this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get'),
       this._moduleID, this._ast, expression, this._pathResolver, tags, this._eventbus);

      // Insert test doc and reset.
      this._docDB.insertStaticDoc(staticDoc);
   }

   /**
    * Traverse doc comments in given file.
    *
    * @private
    */
   static _traverse()
   {
      this._eventbus.trigger('typhonjs:ast:walker:traverse', this._ast,
      {
         enterNode: (node, parent) =>
         {
            try
            {
               this.push(node, parent);
            }
            catch (fatalError)
            {
               switch (this._handleError)
               {
                  case 'log':
                     this._eventbus.trigger('tjsdoc:system:invalid:code:add',
                      { filePath: this.filePath, node, fatalError });
                     break;

                  case 'throw':
                     throw fatalError;
               }
            }
         }
      });
   }
}
