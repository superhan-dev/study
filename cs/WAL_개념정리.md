# WAL 이란?

Write Ahead Logging

postgresql 에서 사용하는 로그이며 데이터가 변경시점(create, update, delete)에서 사용되는 로그이다.
CDC 개념을 함께 사용하기도 하는 로그로 계속해서 DB를 poll해야하는 상태 변경시 놓칠 수 있는 delete 상태 까지도 트레킹할 수 있다.
