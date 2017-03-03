import AbstractTestDoc  from 'tjsdoc-docs-common/src/doc/abstract/AbstractTestDoc.js';

/**
 * Doc Class from test code file.
 */
export default class TestDoc extends AbstractTestDoc
{
   /** set describe by using test node arguments. */
   _$desc()
   {
      super._$desc();

      if (this._value.description) { return; }

      this._value.description = this._node.arguments[0].value;
   }

   /** use name property of self node. */
   _$kind()
   {
      switch (this._node.callee.name)
      {
         case 'suite': // fall
         case 'context': // fall
         case 'describe':
            this._value.kind = 'testDescribe';
            break;

         case 'test': // fall
         case 'it':
            this._value.kind = 'testIt';
            break;

         default:
            throw new Error(`unknown name. node.callee.name = ${this._node.callee.name}`);
      }
   }

   /** set memberof to use parent test nod and file path. */
   _$memberof()
   {
      const chain = [];
      let parent = this._node.parent;

      while (parent)
      {
         if (parent._tjsdocTestName) { chain.push(parent._tjsdocTestName); }

         parent = parent.parent;
      }

      const filePath = this._pathResolver.filePath;

      if (chain.length)
      {
         this._value.memberof = `${filePath}~${chain.reverse().join('.')}`;
         this._value.testDepth = chain.length;
      }
      else
      {
         this._value.memberof = filePath;
         this._value.testDepth = 0;
      }
   }
}
