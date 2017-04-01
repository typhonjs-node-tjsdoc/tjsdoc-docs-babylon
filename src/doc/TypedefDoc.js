import AbstractTypedefDoc  from 'tjsdoc-docs-common/src/doc/abstract/AbstractTypedefDoc.js';

/**
 * Doc class for virtual comment node of typedef.
 */
export default class TypedefDoc extends AbstractTypedefDoc
{
   /** set memberof by using file path. */
   static _$memberof()
   {
      let memberof;
      let parent = this._node.parent;

      while (parent)
      {
         if (parent.type === 'ClassDeclaration')
         {
            memberof = `${this._pathResolver.filePath}~${parent.id.name}`;
            this._value.memberof = memberof;
            return;
         }
         parent = parent.parent;
      }

      this._value.memberof = this._pathResolver.filePath;
   }
}
