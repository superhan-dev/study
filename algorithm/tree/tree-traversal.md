# 작성일

- 2025-10-26

# 트리

트리는 Node라는 자료구조를 최소 단위로 가지고 있는 자료구조이며, 노드간 부모, 자식 관계로 연결되어있는 특징을 가지고 있다.
컴퓨터 공학에서 기본적으로 사용되는 이진 트리(Binary Tree)로 왼쪽 자식과 오른쪽 자식을 바라보도록 구성되어 있다.
따라서 다음과 같이 하나의 가장 작은 단위의 트리를 표현할 수 있다.

```
root -> left
root -> right
```

코드 상에서는 배열 또는 리스트로 트리를 구현한다.

```java
int tree = new int[]{1,2,3} // [root, left, right]
```

## 노드

트리를 이해하기 위해 노드라는 자료구조를 이해해야 한다.

```java
class Node {
    Object data;
    Node left;
    Node right;

    public Node(Object data){
        this.data = data;
    }
}
```

## Tree 에서는 Root 노드를 갖는다.

루트 노드를 가지고 나머지 노드는 순회를 하는 방식을 주로 사용한다.

```java
class BinaryTree {
    Object root;

    public BinaryTree(Object root) {
        this.root = root;
    }

    public CreateSimpleTree(){
        Node root = new Node(1);
        root.left = new Node(2);
        root.right = new Node(3);

        root.left.left = new Node(4);
        root.right.right = new Node(5);
    }
}
```

# 트리 순회 종류

트리 순회 종류는 preorder, inorder, postorder가 존재하며 각각 전위, 중위, 후위 순회 라고 표현한다.

코드상에서 순회 시키는 방법은 재귀 호출을 통한 방법이 가장 흔하게 사용된다.

## 전위 순회 (preorder)

트리를 순회하는 방법 중 루트 -> 왼쪽 -> 오른쪽 순으로 이동하는 순회를 의미한다.

```java
class BinaryTree {
    // ...
    public void preorder(Node node){
        System.out.print(node.data + " "); // 루트를 출력한 후에 왼쪽, 오른쪽 을 재귀탐색 하면서 출력한다.
        preorder(node.left);
        preorder(node.right);
    }
}

```

## 중위 순회 (inorder)

왼쪽 -> 루트 -> 오른쪽 순으로 순회한다.

```java
class BinaryTree {
    // ...
    public void inorder(Node node){
        inorder(node.left);
        System.out.println(node.data + " ");
        inorder(node.right);
    }
}
```

## 후위 순회 (postorder)

왼쪽 -> 오른쪽 -> 루트 순으로 순회한다.

```java
class BinaryTree {
    // ...
    public void postorder(Node node){
        postorder(node.left);
        postorder(node.right);
        System.out.println(node.data + " ");
    }
}
```

# 트리 삽입/삭제

트리의 삽입은 루트보다 작은 값을 왼쪽으로, 큰 값을 오른쪽으로 저장한다.

## 삽입(insert)

```java
class BinaryTree {
    public Node insert(Node node) {
        if(root == null) {
            root = node;
            return root;
        }

        if(root.data < node.data) {
            root.left = insert(root.left);
        } else if(root.data > node.data){
            root.right = insert(root.right);;
        }
        return root;
    }
}
```
