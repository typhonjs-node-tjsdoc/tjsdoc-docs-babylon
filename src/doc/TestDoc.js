import TestDocBase  from 'tjsdoc-docs-common/src/doc/base/TestDocBase.js';

/**
 * Doc Class from test code file.
 */
export default class TestDoc extends TestDocBase
{
   /** Use name property of self node to determine test category. */
   static _$category()
   {
      switch (this._node.callee.name)
      {
         case 'suite':
         case 'context':
         case 'describe':
            this._value.category = 'describe';
            break;

         case 'test':
         case 'it':
            this._value.category = 'it';
            break;

         default:
            throw new Error(`Unknown name. node.callee.name = ${this._node.callee.name}`);
      }
   }

   /** set describe by using test node arguments. */
   static _$desc()
   {
      super._$desc();

      if (this._value.description) { return; }

      this._value.description = this._node.arguments[0].value;
   }

   /** set memberof to use parent test nod and file path. */
   static _$memberof()
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
