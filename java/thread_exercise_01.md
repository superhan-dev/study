# 쓰레드 연습

# 작성일

- 2025-11-01

# 코드

sleepTime 인자를 받아서 정해진 시간만큼 쓰레드를 sleep하게 만드는 특징을 가진 클래스를 선언했다.

## sleep

- 정해진 시간만큼 쓰레드가 잠시 멈추도록 제어한다.

## new

- 쓰레드를 생성시 쓰레드의 상태는 NEW 상태를 갖는다.

## start

- 생성된 쓰레드를 시작시킨다. 이때 상태는 RUNNABLE 상태가 된다.

## join

- 쓰레드 상태가 종료될 때까지 기다리도록 제어한다.

## interrupt

- 쓰레드를 TERMINATED 상태로 만들어 완전히 종료한다.
  - 만약 실행중인 상태라면 Interrupt Exception을 발생시킨다.

```java
package org.example;

class SleepThread extends Thread {
    private int sleepTime;
    public SleepThread(int sleepTime) {
        this.sleepTime = sleepTime;
    }

    @Override
    public void run() {
        try {
            System.out.println("Sleeping "+ getName());
            Thread.sleep(sleepTime);
            System.out.println("Stopping" + getName());
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }

}

public class Main {
    public static void main(String[] args) {
        Main main = new Main();
        main.checkThreadState();
    }

    public void checkThreadState(){
        SleepThread thread = new SleepThread(2000);
        try {
            System.out.println("thread state=" + thread.getState());
            thread.start();
            System.out.println("thread state(after start)=" + thread.getState());
            Thread.sleep(1000);
            System.out.println("thread state(after 1sec)=" + thread.getState());
            // thread.join(); 실행중인 쓰레드가 종료될때까지 기다리도록 제어한다.
            thread.join(500);
            thread.interrupt(); // 실행 중인 쓰레드를 종료하려고 하면 에러가 발생한다.
            System.out.println("thread state(after interrupt)=" + thread.getState());
        } catch (InterruptedException ie) {
            ie.printStackTrace();
        }
    }

}

```
