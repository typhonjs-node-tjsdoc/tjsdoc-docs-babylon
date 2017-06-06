import * as Docs  from '../doc/';

/**
 * Test doc generator. Provides static doc object generation for test files inserting into the given DocDB.
 *
 * TestDocGenerator is much simpler that DocGenerator. Presently only parsing of Mocha tests are provided.
 *
 * Mocha functions invoked are processed: 'context', 'describe', 'it', 'suite', 'test'.
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
    * Sets any test type from the target project TJSDocConfig instance. By setting the test type in `onPreGenerate`
    * it is possible to provide the same method signature for `resetAndTraverse` as `DocGenerator`.
    *
    * @param {PluginEvent} ev - The plugin event.
    */
   static onPreGenerate(ev)
   {
      if (ev.data.mainConfig.test) { this._type = ev.data.mainConfig.test.type; }
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
    * @param {string}         [handleError='throw'] - Determines how to handle errors. Options are `log` and `throw`
    *                                                 with the default being to throw any errors encountered.
    *
    * @param {function}       [docFilter] - An optional function invoked with the static doc before inserting into the
    *                                       given DocDB.
    */
   static resetAndTraverse({ ast, docDB, pathResolver, eventbus, handleError = 'throw', docFilter = void 0 } = {})
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

      /**
       * Optional function to invoke before a static doc is added to the given DocDB.
       * @type {Function}
       * @private
       */
      this._docFilter = docFilter;

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
      this._insertStaticDoc(staticDoc);

      this._traverse();
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
    * Inserts a doc into the associated DocDB after running any optionally supplied doc filter.
    *
    * @param {StaticDoc}   staticDoc - Static doc object to insert into the associated DocDB.
    *
    * @private
    */
   static _insertStaticDoc(staticDoc)
   {
      this._docDB.insertStaticDoc(staticDoc, this._docFilter);
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
    * Push node as mocha test code.
    *
    * @param {ASTNode} node - target node.
    *
    * @private
    */
   static _pushForMocha(node)
   {
      if (node.type !== 'ExpressionStatement') { return; }

      const expression = node.expression;

      if (expression.type !== 'CallExpression') { return; }

      // Add a test doc for Mocha function types.
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

      // Create the static doc with the next global doc ID and current file / module ID.
      const staticDoc = Docs.TestDoc.create(this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get'),
       this._moduleID, this._ast, expression, this._pathResolver, tags, this._eventbus);

      // Insert test doc and reset.
      this._insertStaticDoc(staticDoc);
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
                      { filePath: this._pathResolver.filePath, node, fatalError });
                     break;

                  case 'throw':
                     throw fatalError;
               }
            }
         }
      });
   }
}

// Module private ---------------------------------------------------------------------------------------------------

/**
 * Provides a symbol to store checking if already covered.
 * @type {Symbol}
 * @ignore
 */
const s_ALREADY = Symbol('already');
