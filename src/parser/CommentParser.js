import AbstractCommentParser from 'tjsdoc-docs-common/src/parser/AbstractCommentParser.js';

/**
 * Doc Comment Parser class.
 *
 * @example
 * // When enabled as a plugin wired up on the main eventbus.
 *
 * for (let comment of node.leadingComments)
 * {
 *   let tags = eventbus.triggerSync('tjsdoc:parse:comment', comment);
 *   console.log(tags);
 * }
 */
export default class CommentParser extends AbstractCommentParser
{
   /**
    * Returns the value of the comment node.
    *
    * @param {ASTNode} commentNode - An AST node with potential comment block.
    *
    * @returns {string|undefined} If node is a valid comment node return the value of the node or undefined.
    */
   getCommentValue(commentNode)
   {
      if (commentNode.type !== 'CommentBlock') { return void 0; }

      return commentNode.value.charAt(0) === '*' ? commentNode.value : void 0;
   }
}
