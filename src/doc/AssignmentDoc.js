import AbstractAssignmentDoc  from 'tjsdoc-docs-common/src/doc/abstract/AbstractAssignmentDoc.js';

/**
 * Doc Class for Assignment AST node.
 */
export default class AssignmentDoc extends AbstractAssignmentDoc
{
   /**
    * Take out self name from self node.
    */
   static _$name()
   {
      this._value.name = this._eventbus.triggerSync('tjsdoc:system:ast:member:expression:flatten',
       this._node.left).replace(/^this\./, '');
   }
}

